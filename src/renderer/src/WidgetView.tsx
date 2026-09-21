import { useCallback, useEffect, useRef, useState } from 'react'
import type { BootstrapSnapshot, WidgetSnapshot } from '../../shared/ipc-contract'
import type { Task } from '../../shared/model'
import type { Copy } from './i18n'
import {
  formatDateOnly,
  formatInstant,
  formatSchedule,
  ipcError,
  newRequestId,
  unknownError
} from './ui-utils'

type SnapshotState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: WidgetSnapshot }
  | { phase: 'error'; message: string }

interface WidgetViewProps {
  bootstrap: BootstrapSnapshot
  copy: Copy
}

function MoreCount({ total, shown, copy }: { total: number; shown: number; copy: Copy }): React.JSX.Element | null {
  const remaining = Math.max(0, total - shown)
  return remaining > 0
    ? <span className="more-count" data-testid="section-more-count">{copy.more(remaining)}</span>
    : null
}

function TaskDates({ task, isOverdue, bootstrap, copy }: {
  task: Task
  isOverdue?: boolean
  bootstrap: BootstrapSnapshot
  copy: Copy
}): React.JSX.Element | null {
  if (!task.planDate && !task.dueDate) return null
  return (
    <div className="item-meta">
      {task.planDate ? <span>{copy.planned} · {formatDateOnly(task.planDate, bootstrap.locale)}</span> : null}
      {task.dueDate
        ? <span className={isOverdue ? 'danger-chip' : undefined}>{isOverdue ? copy.overdue : copy.due} · {formatDateOnly(task.dueDate, bootstrap.locale)}</span>
        : null}
    </div>
  )
}

export function WidgetView({ bootstrap, copy }: WidgetViewProps): React.JSX.Element {
  const [state, setState] = useState<SnapshotState>({ phase: 'loading' })
  const [selectedDate, setSelectedDate] = useState(bootstrap.currentDate)
  const [pendingTasks, setPendingTasks] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string>()
  const generation = useRef(0)
  const active = useRef(true)

  const refresh = useCallback(async (clearTaskPending = false): Promise<void> => {
    const currentGeneration = ++generation.current
    try {
      const result = await window.quietDesk.widget.getSnapshot({
        requestId: newRequestId(),
        payload: {}
      })
      if (!active.current || currentGeneration !== generation.current) return
      if (!result.ok) {
        setState({ phase: 'error', message: ipcError(result) })
        return
      }
      setState({ phase: 'ready', value: result.value })
      if (clearTaskPending) setPendingTasks(new Set())
      setActionError(undefined)
    } catch (reason) {
      if (active.current && currentGeneration === generation.current) {
        setState({ phase: 'error', message: unknownError(reason) })
      }
    }
  }, [])

  useEffect(() => {
    active.current = true
    const unsubscribe = window.quietDesk.changes.subscribe((event) => {
      if (event.topics.some((topic) => topic === 'tasks' || topic === 'notes' || topic === 'schedules')) {
        void refresh(event.topics.includes('tasks'))
      }
    })
    void refresh()
    return () => {
      active.current = false
      generation.current += 1
      unsubscribe()
    }
  }, [refresh])

  useEffect(() => setSelectedDate(bootstrap.currentDate), [bootstrap.currentDate])

  const setCompletion = async (task: Task, action: 'complete' | 'reopen'): Promise<void> => {
    setActionError(undefined)
    setPendingTasks((current) => new Set(current).add(task.id))
    try {
      const result = await window.quietDesk.tasks.setCompletion({
        requestId: newRequestId(),
        idempotencyKey: newRequestId(),
        payload: { id: task.id, expectedRevision: task.revision, action }
      })
      if (!result.ok) {
        setPendingTasks((current) => {
          const next = new Set(current)
          next.delete(task.id)
          return next
        })
        setActionError(ipcError(result))
      }
      // Success is deliberately not patched into local state. The committed change event refreshes the snapshot.
    } catch (reason) {
      setPendingTasks((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
      setActionError(unknownError(reason))
    }
  }

  const showWindow = async (target: 'capture' | 'library', date?: string): Promise<void> => {
    setActionError(undefined)
    try {
      const result = await window.quietDesk.windows.show({
        requestId: newRequestId(),
        payload: target === 'library' && date ? { target, selectedDate: date } : { target }
      })
      if (!result.ok) setActionError(ipcError(result))
    } catch (reason) {
      setActionError(unknownError(reason))
    }
  }

  if (state.phase === 'loading') {
    return <section className="section-card skeleton-card" aria-live="polite"><p>{copy.loading}</p></section>
  }

  if (state.phase === 'error') {
    return (
      <section className="section-card error-card" aria-live="polite">
        <p>{state.message}</p>
        <button type="button" onClick={() => void refresh()}>{copy.retry}</button>
      </section>
    )
  }

  const snapshot = state.value

  return (
    <div className="widget-layout">
      <nav className="widget-command-bar" aria-label={copy.browseDate}>
        <label className="date-control">
          <span>{copy.browseDate}</span>
          <input
            data-testid="widget-date"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="button-secondary compact-button"
          data-testid="open-library"
          onClick={() => void showWindow('library', selectedDate)}
        >
          <span className="button-icon" aria-hidden="true">▦</span><span className="button-label">{copy.openLibrary}</span>
        </button>
        <button
          type="button"
          className="button-accent compact-button capture-button"
          data-testid="open-capture"
          onClick={() => void showWindow('capture')}
        >
          <span className="button-icon" aria-hidden="true">＋</span><span className="button-label">{copy.openCapture}</span>
        </button>
      </nav>

      {actionError ? <p className="inline-error" role="status">{copy.operationFailed}: {actionError}</p> : null}

      <div className="widget-sections">
        <section className="section-card tasks-section" aria-labelledby="current-tasks-heading">
          <div className="section-heading">
            <h2 id="current-tasks-heading">{copy.currentTasks}</h2>
            <span className="count-badge">{snapshot.totals.currentTasks}</span>
          </div>
          {snapshot.currentTasks.length === 0
            ? <p className="empty-state">{copy.noTasks}</p>
            : (
              <ul className="item-list" data-testid="current-task-list">
                {snapshot.currentTasks.map(({ task, isOverdue }) => (
                  <li className="item-row task-row" data-testid="current-task-item" data-entity-id={task.id} key={task.id}>
                    <button
                      type="button"
                      className="completion-toggle"
                      data-testid="task-completion-toggle"
                      aria-label={`${copy.completed}: ${task.title}`}
                      disabled={pendingTasks.has(task.id)}
                      onClick={() => void setCompletion(task, 'complete')}
                    >
                      {pendingTasks.has(task.id) ? <span className="mini-spinner" /> : <span aria-hidden="true" />}
                    </button>
                    <div className="item-copy">
                      <strong>{task.title}</strong>
                      <TaskDates task={task} isOverdue={isOverdue} bootstrap={bootstrap} copy={copy} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          <MoreCount total={snapshot.totals.currentTasks} shown={snapshot.currentTasks.length} copy={copy} />
        </section>

        <section className="section-card schedule-section" aria-labelledby="today-schedule-heading">
          <div className="section-heading">
            <h2 id="today-schedule-heading">{copy.todaySchedule}</h2>
            <span className="count-badge">{snapshot.totals.todaySchedules}</span>
          </div>
          {snapshot.todaySchedules.length === 0
            ? <p className="empty-state">{copy.noSchedules}</p>
            : (
              <ul className="item-list" data-testid="today-schedule-list">
                {snapshot.todaySchedules.map(({ schedule, continuesBefore, continuesAfter }) => (
                  <li className="item-row schedule-row" data-testid="today-schedule-item" data-entity-id={schedule.id} key={schedule.id}>
                    <span className="schedule-marker" aria-hidden="true" />
                    <div className="item-copy">
                      <strong>{schedule.title}</strong>
                      <div className="item-meta">
                        <span>{schedule.kind === 'all-day' ? copy.allDay : formatSchedule(schedule, bootstrap.locale, snapshot.appTimeZone)}</span>
                        {continuesBefore ? <span>{copy.continuesFromBefore}</span> : null}
                        {continuesAfter ? <span>{copy.continuesAfter}</span> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          <MoreCount total={snapshot.totals.todaySchedules} shown={snapshot.todaySchedules.length} copy={copy} />
        </section>

        <section className="section-card notes-section" aria-labelledby="recent-notes-heading">
          <div className="section-heading">
            <h2 id="recent-notes-heading">{copy.recentNotes}</h2>
            <span className="count-badge">{snapshot.totals.recentNotes}</span>
          </div>
          {snapshot.recentNotes.length === 0
            ? <p className="empty-state">{copy.noNotes}</p>
            : (
              <ul className="item-list" data-testid="recent-note-list">
                {snapshot.recentNotes.map(({ note, plainTextPreview }) => (
                  <li className="item-row note-row" data-testid="recent-note-item" data-entity-id={note.id} key={note.id}>
                    <div className="item-copy">
                      <strong>{note.title || plainTextPreview || copy.note}</strong>
                      {plainTextPreview ? <p className="item-preview">{plainTextPreview}</p> : null}
                    </div>
                    <time>{formatInstant(note.updatedAtUtc, bootstrap.locale, snapshot.appTimeZone)}</time>
                  </li>
                ))}
              </ul>
            )}
          <MoreCount total={snapshot.totals.recentNotes} shown={snapshot.recentNotes.length} copy={copy} />
        </section>

        <details className="section-card completed-section" data-testid="completed-today-toggle">
          <summary>
            <span>{copy.completedToday}</span>
            <span className="count-badge">{snapshot.totals.completedToday}</span>
          </summary>
          {snapshot.completedToday.length === 0
            ? <p className="empty-state">{copy.noCompleted}</p>
            : (
              <ul className="item-list completed-list" data-testid="completed-today-list">
                {snapshot.completedToday.map((task) => (
                  <li className="item-row completed-row" data-entity-id={task.id} key={task.id}>
                    <div className="item-copy">
                      <strong>{task.title}</strong>
                      {task.completedAtUtc
                        ? <span className="item-meta">{formatInstant(task.completedAtUtc, bootstrap.locale, snapshot.appTimeZone)}</span>
                        : null}
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      disabled={pendingTasks.has(task.id)}
                      onClick={() => void setCompletion(task, 'reopen')}
                    >
                      {copy.restore}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <MoreCount total={snapshot.totals.completedToday} shown={snapshot.completedToday.length} copy={copy} />
        </details>
      </div>
    </div>
  )
}
