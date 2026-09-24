import { useCallback, useEffect, useRef, useState } from 'react'
import type { DailyLog, DailyLogItem, DateOnly } from '../../shared/model'
import type { Locale } from '../../shared/ipc-contract'
import type { Copy } from './i18n'
import { MarkdownView } from './MarkdownView'
import { formatDateOnly, ipcError, newRequestId, unknownError } from './ui-utils'

type SavePhase = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'
type ExportPhase = 'idle' | 'exporting' | 'saved' | 'cancelled' | 'error'

interface LogState {
  phase: 'loading' | 'ready' | 'error'
  log?: DailyLog
  manual: string
  baseRevision: number
  editVersion: number
  dirty: boolean
  savePhase: SavePhase
  saveKey?: string
  saveError?: string
  loadError?: string
  exportPhase: ExportPhase
  exportError?: string
}

const emptyState = (): LogState => ({
  phase: 'loading', manual: '', baseRevision: 0, editVersion: 0,
  dirty: false, savePhase: 'idle', exportPhase: 'idle'
})

const sections: { section: DailyLogItem['section']; label: keyof Pick<Copy, 'logCompleted' | 'logPending' | 'logPlanned' | 'logNotes'> }[] = [
  { section: 'completed', label: 'logCompleted' },
  { section: 'pending-at-boundary', label: 'logPending' },
  { section: 'planned', label: 'logPlanned' },
  { section: 'notes', label: 'logNotes' }
]

export function DailyLogSections({ log, copy }: { log: DailyLog; copy: Copy }): React.JSX.Element {
  return (
    <div className="daily-log-sections">
      {sections.map(({ section, label }) => {
        const items = log.autoItems.filter((item) => item.section === section)
          .sort((a, b) => a.stableOrder - b.stableOrder)
        return (
          <section className="daily-log-section" key={section} data-testid={`daily-log-${section}`}>
            <div className="section-heading"><h4>{copy[label]}</h4><span className="count-badge">{items.length}</span></div>
            {items.length === 0 ? <p className="empty-state">{copy.logNoItems}</p> : (
              <ol className="daily-log-items">
                {items.map((item) => <li key={item.id}><MarkdownView markdown={item.snapshotMarkdown} copy={copy} /></li>)}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}

export function DailyLogPanel({ date, locale, copy, refreshToken }: {
  date: DateOnly; locale: Locale; copy: Copy; refreshToken: number
}): React.JSX.Element {
  const [states, setStates] = useState<Record<string, LogState>>({})
  const statesRef = useRef(states)
  const generations = useRef<Record<string, number>>({})
  const saving = useRef<Record<string, Promise<boolean>>>({})
  const activeDate = useRef(date)
  const mounted = useRef(true)
  const [manualView, setManualView] = useState<'source' | 'preview'>('source')
  activeDate.current = date

  const update = useCallback((targetDate: string, transform: (current: LogState) => LogState): void => {
    if (!mounted.current) return
    const next = { ...statesRef.current, [targetDate]: transform(statesRef.current[targetDate] ?? emptyState()) }
    statesRef.current = next
    setStates(next)
  }, [])

  const load = useCallback(async (targetDate: DateOnly, discardManual = false): Promise<DailyLog | undefined> => {
    const generation = (generations.current[targetDate] ?? 0) + 1
    generations.current[targetDate] = generation
    update(targetDate, (current) => ({ ...current, phase: current.log ? 'ready' : 'loading', loadError: undefined }))
    try {
      const result = await window.quietDesk.dailyLogs.get({ requestId: newRequestId(), payload: { date: targetDate } })
      if (!mounted.current || generations.current[targetDate] !== generation) return undefined
      if (!result.ok) {
        update(targetDate, (current) => ({
          ...current, phase: current.log ? 'ready' : 'error', loadError: ipcError(result)
        }))
        return undefined
      }
      update(targetDate, (current) => {
        const keepManual = current.dirty && !discardManual
        return {
          ...current, phase: 'ready', log: result.value,
          manual: keepManual ? current.manual : result.value.manualMarkdown,
          baseRevision: keepManual ? current.baseRevision : result.value.manualRevision,
          dirty: keepManual,
          savePhase: keepManual ? current.savePhase : 'idle',
          saveKey: keepManual ? current.saveKey : undefined,
          saveError: keepManual ? current.saveError : undefined,
          loadError: undefined
        }
      })
      return result.value
    } catch (reason) {
      if (mounted.current && generations.current[targetDate] === generation) {
        update(targetDate, (current) => ({
          ...current, phase: current.log ? 'ready' : 'error', loadError: unknownError(reason)
        }))
      }
      return undefined
    }
  }, [update])

  useEffect(() => {
    mounted.current = true
    void load(date)
    return () => { mounted.current = false }
  }, [date, load, refreshToken])

  useEffect(() => {
    const unsubscribe = window.quietDesk.changes.subscribe((event) => {
      if (event.topics.some((topic) => topic === 'tasks' || topic === 'notes' || topic === 'schedules' || topic === 'daily-logs')) {
        void load(activeDate.current)
      }
    })
    return unsubscribe
  }, [load])

  const saveManual = async (targetDate: DateOnly): Promise<boolean> => {
    const inFlight = saving.current[targetDate]
    if (inFlight) {
      if (!await inFlight) return false
    }
    const current = statesRef.current[targetDate]
    if (!current?.log || current.phase !== 'ready') return false
    if (!current.dirty) return true
    if (current.savePhase === 'conflict') return false
    const version = current.editVersion
    const markdown = current.manual
    const key = current.saveKey ?? newRequestId()
    update(targetDate, (state) => ({ ...state, savePhase: 'saving', saveKey: key, saveError: undefined }))
    const task = (async (): Promise<boolean> => {
      try {
        const result = await window.quietDesk.dailyLogs.saveManual({
          requestId: newRequestId(), idempotencyKey: key,
          payload: { date: targetDate, expectedRevision: current.baseRevision, manualMarkdown: markdown }
        })
        if (!result.ok) {
          update(targetDate, (state) => ({
            ...state, savePhase: result.error.code === 'CONFLICT' ? 'conflict' : 'error',
            saveError: ipcError(result)
          }))
          return false
        }
        update(targetDate, (state) => {
          const editedAgain = state.editVersion !== version
          const manual = editedAgain ? state.manual : result.value.manualMarkdown
          const dirty = manual !== result.value.manualMarkdown
          return {
            ...state, log: result.value, baseRevision: result.value.manualRevision,
            manual,
            dirty, savePhase: dirty ? 'idle' : 'saved',
            saveKey: undefined, saveError: undefined
          }
        })
        return true
      } catch (reason) {
        update(targetDate, (state) => ({ ...state, savePhase: 'error', saveError: unknownError(reason) }))
        return false
      }
    })()
    saving.current[targetDate] = task
    try { return await task } finally { delete saving.current[targetDate] }
  }

  const exportLog = async (): Promise<void> => {
    const targetDate = date
    if (statesRef.current[targetDate]?.exportPhase === 'exporting') return
    update(targetDate, (current) => ({ ...current, exportPhase: 'exporting', exportError: undefined }))
    // A save can finish while the user types more; repeat until the current text is durable.
    while (statesRef.current[targetDate]?.dirty) {
      if (!await saveManual(targetDate)) {
        update(targetDate, (current) => ({ ...current, exportPhase: 'idle' }))
        return
      }
      if (activeDate.current !== targetDate) {
        update(targetDate, (current) => ({ ...current, exportPhase: 'idle' }))
        return
      }
    }
    if (activeDate.current !== targetDate) return
    try {
      const result = await window.quietDesk.dailyLogs.export({ requestId: newRequestId(), payload: { date: targetDate } })
      update(targetDate, (current) => result.ok
        ? { ...current, exportPhase: result.value.status }
        : { ...current, exportPhase: 'error', exportError: ipcError(result) })
    } catch (reason) {
      update(targetDate, (current) => ({ ...current, exportPhase: 'error', exportError: unknownError(reason) }))
    }
  }

  const useMyText = async (): Promise<void> => {
    const targetDate = date
    const latest = await load(targetDate)
    if (!latest) return
    update(targetDate, (current) => ({
      ...current, baseRevision: latest.manualRevision,
      savePhase: 'idle', saveKey: undefined, saveError: undefined
    }))
    await saveManual(targetDate)
  }

  const state = states[date] ?? emptyState()
  const canInteract = state.phase === 'ready' && !!state.log
  return (
    <section className="section-card daily-log-panel" aria-label={copy.dailyLog} data-testid="daily-log-panel">
      <header className="section-heading daily-log-heading">
        <div><p className="eyebrow">{copy.dailyLog}</p><h3>{formatDateOnly(date, locale)}</h3></div>
        <button type="button" className="icon-button" aria-label={copy.refresh} onClick={() => void load(date)}>↻</button>
      </header>
      {state.phase === 'loading' ? <p>{copy.loading}</p> : null}
      {state.loadError ? <p className="inline-error" role="alert">{state.loadError} <button type="button" onClick={() => void load(date)}>{copy.retry}</button></p> : null}
      {canInteract && state.log ? <DailyLogSections log={state.log} copy={copy} /> : null}
      {canInteract ? (
        <section className="daily-log-manual">
          <div className="section-heading">
            <h4>{copy.logManual}</h4>
            <div className="view-toggle" role="group" aria-label={copy.markdownViewMode}>
              <button type="button" className={manualView === 'source' ? 'active' : undefined} aria-pressed={manualView === 'source'} onClick={() => setManualView('source')}>{copy.source}</button>
              <button type="button" className={manualView === 'preview' ? 'active' : undefined} aria-pressed={manualView === 'preview'} onClick={() => setManualView('preview')}>{copy.preview}</button>
            </div>
          </div>
          {manualView === 'source' ? (
            <textarea
              data-testid="daily-log-manual-input" aria-label={copy.logManual}
              value={state.manual} maxLength={1_000_000} disabled={state.exportPhase === 'exporting'}
              onChange={(event) => {
                const manual = event.target.value
                update(date, (current) => ({
                  ...current, manual, editVersion: current.editVersion + 1,
                  dirty: manual !== current.log?.manualMarkdown,
                  savePhase: current.savePhase === 'conflict' && manual !== current.log?.manualMarkdown ? 'conflict' : 'idle',
                  saveKey: undefined, saveError: current.savePhase === 'conflict' && manual !== current.log?.manualMarkdown ? current.saveError : undefined,
                  exportPhase: 'idle'
                }))
              }}
            />
          ) : <MarkdownView markdown={state.manual} copy={copy} className="daily-log-manual-preview" />}
          <div className="daily-log-actions">
            <span className="daily-log-save-status" role="status">
              {state.savePhase === 'saving' ? copy.saving : state.savePhase === 'saved' ? copy.saved : state.dirty ? copy.unsaved : ''}
            </span>
            <button type="button" className="button-secondary" disabled={!state.dirty || state.savePhase === 'saving' || state.savePhase === 'conflict'} onClick={() => void saveManual(date)}>{copy.save}</button>
            <button type="button" className="button-accent" data-testid="daily-log-export" disabled={state.exportPhase === 'exporting' || state.savePhase === 'conflict'} onClick={() => void exportLog()}>{state.exportPhase === 'exporting' ? copy.logExporting : copy.logExport}</button>
          </div>
          {state.saveError ? <p className="inline-error" role="alert">{state.savePhase === 'conflict' ? copy.logConflict : copy.saveFailed}: {state.saveError}</p> : null}
          {state.savePhase === 'conflict' ? <button type="button" className="button-secondary" onClick={() => void useMyText()}>{copy.logUseMyText}</button> : null}
          {state.exportPhase === 'saved' ? <p role="status">{copy.logExportSaved}</p> : null}
          {state.exportPhase === 'cancelled' ? <p role="status">{copy.logExportCancelled}</p> : null}
          {state.exportError ? <p className="inline-error" role="alert">{copy.logExportFailed}: {state.exportError}</p> : null}
          <p className="daily-log-copy-warning">{copy.logIndependentCopyWarning}</p>
        </section>
      ) : null}
    </section>
  )
}
