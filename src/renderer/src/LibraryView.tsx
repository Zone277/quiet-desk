import { useCallback, useEffect, useRef, useState } from 'react'
import type { BootstrapSnapshot, DayViewSnapshot } from '../../shared/ipc-contract'
import type { EntityRecord, OperationSnapshot, TrashEntry } from '../../shared/model'
import type { Copy } from './i18n'
import {
  entityRevision,
  entityTitle,
  formatDateOnly,
  formatInstant,
  formatSchedule,
  ipcError,
  newRequestId,
  nextDate,
  unknownError
} from './ui-utils'

type DayState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: DayViewSnapshot }
  | { phase: 'error'; message: string }

type TrashState =
  | { phase: 'idle' | 'loading' }
  | { phase: 'ready'; value: TrashEntry[] }
  | { phase: 'error'; message: string }

interface LibraryViewProps {
  bootstrap: BootstrapSnapshot
  copy: Copy
}

function operationLabel(operation: OperationSnapshot['operation'], locale: BootstrapSnapshot['locale']): string {
  const zh: Record<OperationSnapshot['operation'], string> = {
    'task.created': '创建任务',
    'task.updated': '编辑任务',
    'task.completed': '完成任务',
    'task.reopened': '重新打开',
    'task.rescheduled': '任务改期',
    'note.created': '创建笔记',
    'note.updated': '编辑笔记',
    'schedule.created': '创建日程',
    'schedule.updated': '编辑日程',
    'entity.trashed': '移到回收站',
    'entity.restored': '恢复项目'
  }
  const en: Record<OperationSnapshot['operation'], string> = {
    'task.created': 'Task created',
    'task.updated': 'Task edited',
    'task.completed': 'Task completed',
    'task.reopened': 'Task reopened',
    'task.rescheduled': 'Task rescheduled',
    'note.created': 'Note created',
    'note.updated': 'Note edited',
    'schedule.created': 'Schedule created',
    'schedule.updated': 'Schedule edited',
    'entity.trashed': 'Moved to trash',
    'entity.restored': 'Restored'
  }
  return (locale === 'zh-CN' ? zh : en)[operation]
}

function EntityBody({ record, bootstrap, copy }: {
  record: EntityRecord
  bootstrap: BootstrapSnapshot
  copy: Copy
}): React.JSX.Element {
  const entity = record.value
  return (
    <div className="entity-detail-content">
      <div className="detail-heading">
        <span className="entity-type-chip">{record.type}</span>
        <span>{copy.revision(entity.revision)}</span>
      </div>
      <h3>{entityTitle(record)}</h3>
      {record.type === 'task' ? (
        <div className="item-meta detail-meta">
          {record.value.planDate ? <span>{copy.planned} · {formatDateOnly(record.value.planDate, bootstrap.locale)}</span> : null}
          {record.value.dueDate ? <span>{copy.due} · {formatDateOnly(record.value.dueDate, bootstrap.locale)}</span> : null}
          {record.value.completedAtUtc ? <span>{copy.completed} · {formatInstant(record.value.completedAtUtc, bootstrap.locale, bootstrap.appTimeZone)}</span> : null}
        </div>
      ) : null}
      {record.type === 'schedule'
        ? <p className="detail-meta">{record.value.kind === 'all-day' ? copy.allDay : formatSchedule(record.value, bootstrap.locale, bootstrap.appTimeZone)}</p>
        : null}
      <pre className="markdown-source">{entity.bodyMarkdown || '—'}</pre>
    </div>
  )
}

export function LibraryView({ bootstrap, copy }: LibraryViewProps): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState(bootstrap.currentDate)
  const [mode, setMode] = useState<'day' | 'trash'>('day')
  const [day, setDay] = useState<DayState>({ phase: 'loading' })
  const [trash, setTrash] = useState<TrashState>({ phase: 'idle' })
  const [selected, setSelected] = useState<EntityRecord>()
  const [history, setHistory] = useState<OperationSnapshot[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState<TrashEntry>()
  const dayGeneration = useRef(0)
  const active = useRef(true)

  const loadDay = useCallback(async (): Promise<void> => {
    const generation = ++dayGeneration.current
    setDay((current) => current.phase === 'ready' ? current : { phase: 'loading' })
    try {
      const result = await window.quietDesk.library.getDay({
        requestId: newRequestId(),
        payload: { date: selectedDate }
      })
      if (!active.current || generation !== dayGeneration.current) return
      setDay(result.ok
        ? { phase: 'ready', value: result.value }
        : { phase: 'error', message: ipcError(result) })
    } catch (reason) {
      if (active.current && generation === dayGeneration.current) {
        setDay({ phase: 'error', message: unknownError(reason) })
      }
    }
  }, [selectedDate])

  const loadTrash = useCallback(async (): Promise<void> => {
    setTrash({ phase: 'loading' })
    try {
      const result = await window.quietDesk.library.listTrash({ requestId: newRequestId(), payload: {} })
      if (!active.current) return
      setTrash(result.ok
        ? { phase: 'ready', value: result.value }
        : { phase: 'error', message: ipcError(result) })
    } catch (reason) {
      if (active.current) setTrash({ phase: 'error', message: unknownError(reason) })
    }
  }, [])

  useEffect(() => {
    active.current = true
    const unsubscribe = window.quietDesk.changes.subscribe((event) => {
      if (event.topics.some((topic) => topic === 'tasks' || topic === 'notes' || topic === 'schedules')) {
        void loadDay()
        if (mode === 'trash') void loadTrash()
      }
    })
    void loadDay()
    return () => {
      active.current = false
      dayGeneration.current += 1
      unsubscribe()
    }
  }, [loadDay, loadTrash, mode])

  useEffect(() => window.quietDesk.windows.subscribeContext((context) => {
    if (context.target !== 'library') return
    setMode('day')
    setSelected(undefined)
    setHistory([])
    setSelectedDate(context.selectedDate)
  }), [])

  const changeMode = (next: 'day' | 'trash'): void => {
    setMode(next)
    setSelected(undefined)
    setHistory([])
    setActionError(undefined)
    if (next === 'trash') void loadTrash()
  }

  const loadEntity = async (type: EntityRecord['type'], id: string): Promise<void> => {
    setDetailLoading(true)
    setActionError(undefined)
    try {
      const reference = { type, id }
      const [entityResult, historyResult] = await Promise.all([
        window.quietDesk.library.getEntity({ requestId: newRequestId(), payload: reference }),
        window.quietDesk.library.getHistory({ requestId: newRequestId(), payload: reference })
      ])
      if (!entityResult.ok) {
        setActionError(ipcError(entityResult))
        return
      }
      setSelected(entityResult.value)
      setHistory(historyResult.ok ? historyResult.value : [])
      if (!historyResult.ok) setActionError(ipcError(historyResult))
    } catch (reason) {
      setActionError(unknownError(reason))
    } finally {
      setDetailLoading(false)
    }
  }

  const moveToTrash = async (record: EntityRecord): Promise<void> => {
    setPendingId(record.value.id)
    setActionError(undefined)
    try {
      const result = await window.quietDesk.entities.trash({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: {
          entity: { type: record.type, id: record.value.id },
          expectedRevision: entityRevision(record)
        }
      })
      if (!result.ok) setActionError(ipcError(result))
      else {
        setSelected(undefined)
        setHistory([])
      }
    } catch (reason) {
      setActionError(unknownError(reason))
    } finally {
      setPendingId(undefined)
    }
  }

  const restore = async (entry: TrashEntry): Promise<void> => {
    setPendingId(entry.entity.value.id)
    setActionError(undefined)
    try {
      const result = await window.quietDesk.entities.restore({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: {
          entity: { type: entry.entity.type, id: entry.entity.value.id },
          expectedRevision: entityRevision(entry.entity)
        }
      })
      if (!result.ok) setActionError(ipcError(result))
    } catch (reason) {
      setActionError(unknownError(reason))
    } finally {
      setPendingId(undefined)
    }
  }

  const permanentlyDelete = async (entry: TrashEntry): Promise<void> => {
    setPendingId(entry.entity.value.id)
    setActionError(undefined)
    try {
      const result = await window.quietDesk.entities.permanentlyDelete({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: {
          entity: { type: entry.entity.type, id: entry.entity.value.id },
          expectedRevision: entityRevision(entry.entity),
          confirmedEntityId: entry.entity.value.id
        }
      })
      if (!result.ok) setActionError(ipcError(result))
      else setConfirmDelete(undefined)
    } catch (reason) {
      setActionError(unknownError(reason))
    } finally {
      setPendingId(undefined)
    }
  }

  const hide = async (): Promise<void> => {
    try {
      const result = await window.quietDesk.windows.hide({
        requestId: newRequestId(),
        payload: { target: 'library' }
      })
      if (!result.ok) setActionError(ipcError(result))
    } catch (reason) {
      setActionError(unknownError(reason))
    }
  }

  return (
    <div className="library-layout">
      <nav className="library-toolbar" aria-label={copy.library}>
        <div className="segmented-control library-mode">
          <button type="button" className={mode === 'day' ? 'active' : undefined} onClick={() => changeMode('day')}>{copy.browseDate}</button>
          <button type="button" className={mode === 'trash' ? 'active' : undefined} data-testid="trash-open" onClick={() => changeMode('trash')}>{copy.trash}</button>
        </div>
        {mode === 'day' ? (
          <div className="date-browser">
            <button type="button" className="icon-button" data-testid="library-prev-date" aria-label={copy.previousDate} onClick={() => setSelectedDate(nextDate(selectedDate, -1))}>‹</button>
            <input data-testid="library-date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            <button type="button" className="icon-button" data-testid="library-next-date" aria-label={copy.nextDate} onClick={() => setSelectedDate(nextDate(selectedDate, 1))}>›</button>
            <button type="button" className="text-button" data-testid="library-today" onClick={() => setSelectedDate(bootstrap.currentDate)}>{copy.today}</button>
          </div>
        ) : null}
        <button type="button" className="button-ghost close-library" onClick={() => void hide()}>{copy.close}</button>
      </nav>

      {actionError ? <p className="inline-error" role="alert">{copy.operationFailed}: {actionError}</p> : null}

      {mode === 'day' ? (
        <div className="library-columns">
          <section className="library-list-column">
            {day.phase === 'loading' ? <div className="section-card skeleton-card">{copy.loading}</div> : null}
            {day.phase === 'error' ? (
              <div className="section-card error-card"><p>{day.message}</p><button type="button" onClick={() => void loadDay()}>{copy.retry}</button></div>
            ) : null}
            {day.phase === 'ready' ? (
              <>
                <header className="day-heading">
                  <div><p className="eyebrow">{copy.browseDate}</p><h2>{formatDateOnly(day.value.selectedDate, bootstrap.locale)}</h2></div>
                  <button type="button" className="icon-button" aria-label={copy.refresh} onClick={() => void loadDay()}>↻</button>
                </header>

                <section className="section-card library-section">
                  <div className="section-heading"><h3>{copy.dayTasks}</h3><span className="count-badge">{day.value.tasks.length}</span></div>
                  {day.value.tasks.length === 0 ? <p className="empty-state">{copy.noTasks}</p> : (
                    <ul className="item-list" data-testid="library-task-list">
                      {day.value.tasks.map(({ task, matchReasons }) => (
                        <li key={task.id}>
                          <button type="button" className="library-item-button" data-entity-id={task.id} onClick={() => void loadEntity('task', task.id)}>
                            <strong>{task.title}</strong>
                            <span className="item-meta">{matchReasons.map((reason) => reason === 'planned' ? copy.planned : reason === 'due' ? copy.due : copy.completed).join(' · ')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="section-card library-section">
                  <div className="section-heading"><h3>{copy.daySchedules}</h3><span className="count-badge">{day.value.schedules.length}</span></div>
                  {day.value.schedules.length === 0 ? <p className="empty-state">{copy.noSchedules}</p> : (
                    <ul className="item-list" data-testid="library-schedule-list">
                      {day.value.schedules.map(({ schedule, continuesBefore, continuesAfter }) => (
                        <li key={schedule.id}>
                          <button type="button" className="library-item-button" data-entity-id={schedule.id} onClick={() => void loadEntity('schedule', schedule.id)}>
                            <strong>{schedule.title}</strong>
                            <span className="item-meta">
                              {schedule.kind === 'all-day' ? copy.allDay : formatSchedule(schedule, bootstrap.locale, day.value.appTimeZone)}
                              {continuesBefore ? ` · ${copy.continuesFromBefore}` : ''}{continuesAfter ? ` · ${copy.continuesAfter}` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="section-card library-section">
                  <div className="section-heading"><h3>{copy.dayNotes}</h3><span className="count-badge">{day.value.notes.length}</span></div>
                  {day.value.notes.length === 0 ? <p className="empty-state">{copy.noNotes}</p> : (
                    <ul className="item-list" data-testid="library-note-list">
                      {day.value.notes.map(({ note, plainTextPreview }) => (
                        <li key={note.id}>
                          <button type="button" className="library-item-button" data-entity-id={note.id} onClick={() => void loadEntity('note', note.id)}>
                            <strong>{note.title || plainTextPreview || copy.note}</strong>
                            {plainTextPreview ? <span className="item-preview">{plainTextPreview}</span> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : null}
          </section>

          <aside className="detail-column section-card" aria-label={copy.itemDetails}>
            {detailLoading ? <p>{copy.loading}</p> : selected ? (
              <>
                <EntityBody record={selected} bootstrap={bootstrap} copy={copy} />
                <button
                  type="button"
                  className="danger-button"
                  disabled={pendingId === selected.value.id}
                  onClick={() => void moveToTrash(selected)}
                >
                  {copy.moveToTrash}
                </button>
                <section className="history-section">
                  <h3>{copy.history}</h3>
                  {history.length === 0 ? <p className="empty-state">{copy.noHistory}</p> : (
                    <ol className="history-list" data-testid="library-history">
                      {history.map((item) => (
                        <li key={item.operationId}>
                          <strong>{operationLabel(item.operation, bootstrap.locale)}</strong>
                          <time>{formatInstant(item.occurredAtUtc, bootstrap.locale, bootstrap.appTimeZone)}</time>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            ) : <p className="empty-state">{copy.selectItem}</p>}
          </aside>
        </div>
      ) : (
        <section className="trash-view section-card">
          <div className="section-heading"><h2>{copy.trash}</h2><button type="button" className="icon-button" aria-label={copy.refresh} onClick={() => void loadTrash()}>↻</button></div>
          {trash.phase === 'idle' || trash.phase === 'loading' ? <p>{copy.loading}</p> : null}
          {trash.phase === 'error' ? <div className="error-card"><p>{trash.message}</p><button type="button" onClick={() => void loadTrash()}>{copy.retry}</button></div> : null}
          {trash.phase === 'ready' && trash.value.length === 0 ? <p className="empty-state">{copy.trashEmpty}</p> : null}
          {trash.phase === 'ready' && trash.value.length > 0 ? (
            <ul className="trash-list" data-testid="trash-list">
              {trash.value.map((entry) => (
                <li className="trash-row" key={`${entry.entity.type}:${entry.entity.value.id}`}>
                  <div className="item-copy">
                    <span className="entity-type-chip">{entry.entity.type}</span>
                    <strong>{entityTitle(entry.entity)}</strong>
                    <time>{formatInstant(entry.deletedAtUtc, bootstrap.locale, bootstrap.appTimeZone)}</time>
                  </div>
                  <div className="button-row">
                    <button type="button" className="button-secondary" data-testid="trash-restore" disabled={pendingId === entry.entity.value.id} onClick={() => void restore(entry)}>{copy.restore}</button>
                    <button type="button" className="danger-button" data-testid="permanent-delete-open" disabled={pendingId === entry.entity.value.id} onClick={() => setConfirmDelete(entry)}>{copy.permanentlyDelete}</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}

      {confirmDelete ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permanent-delete-title">
            <p className="eyebrow">{confirmDelete.entity.type}</p>
            <h2 id="permanent-delete-title">{copy.confirmPermanentDelete}</h2>
            <strong>{entityTitle(confirmDelete.entity)}</strong>
            <p>{copy.permanentDeleteHint}</p>
            <div className="button-row">
              <button type="button" className="button-secondary" onClick={() => setConfirmDelete(undefined)}>{copy.cancel}</button>
              <button type="button" className="danger-button" data-testid="permanent-delete-confirm" disabled={pendingId === confirmDelete.entity.value.id} onClick={() => void permanentlyDelete(confirmDelete)}>{copy.permanentlyDelete}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
