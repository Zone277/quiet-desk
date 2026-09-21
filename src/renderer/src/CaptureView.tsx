import { useCallback, useEffect, useRef, useState } from 'react'
import type { BootstrapSnapshot } from '../../shared/ipc-contract'
import type { CaptureDraftPayload, CaptureKind, Draft } from '../../shared/model'
import type { Copy } from './i18n'
import {
  fromDateTimeLocal,
  ipcError,
  newRequestId,
  toDateTimeLocal,
  unknownError
} from './ui-utils'

const QUICK_CAPTURE_DRAFT_ID = '10000000-0000-4000-8000-000000000001'

type FormKind = 'note' | 'task' | 'timed-schedule' | 'all-day-schedule'

interface CaptureForm {
  kind: FormKind
  title: string
  bodyMarkdown: string
  planDate: string
  dueDate: string
  timedStart: string
  timedEnd: string
  allDayStart: string
  allDayEnd: string
}

type SaveState = 'loading' | 'unsaved' | 'saving' | 'saved' | 'failed' | 'incomplete' | 'conflict'

const EMPTY_FORM: CaptureForm = {
  kind: 'note',
  title: '',
  bodyMarkdown: '',
  planDate: '',
  dueDate: '',
  timedStart: '',
  timedEnd: '',
  allDayStart: '',
  allDayEnd: ''
}

function captureKind(kind: FormKind): CaptureKind {
  return kind === 'note' ? 'note' : kind === 'task' ? 'task' : 'schedule'
}

function toPayload(form: CaptureForm, timeZone: string): CaptureDraftPayload {
  if (form.kind === 'note') {
    return { kind: 'note', title: form.title, bodyMarkdown: form.bodyMarkdown }
  }
  if (form.kind === 'task') {
    return {
      kind: 'task',
      title: form.title,
      bodyMarkdown: form.bodyMarkdown,
      planDate: form.planDate || null,
      dueDate: form.dueDate || null
    }
  }
  if (form.kind === 'timed-schedule') {
    const startAtUtc = fromDateTimeLocal(form.timedStart, timeZone)
    const endAtUtc = fromDateTimeLocal(form.timedEnd, timeZone)
    return {
      kind: 'timed-schedule',
      title: form.title,
      bodyMarkdown: form.bodyMarkdown,
      startAtUtc,
      endAtUtc
    }
  }
  return {
    kind: 'all-day-schedule',
    title: form.title,
    bodyMarkdown: form.bodyMarkdown,
    startDate: form.allDayStart || null,
    endDateExclusive: form.allDayEnd || null
  }
}

function formFromDraft(draft: Draft, timeZone: string): CaptureForm {
  const payload = draft.payload
  if (payload.kind === 'note') {
    return { ...EMPTY_FORM, kind: 'note', title: payload.title, bodyMarkdown: payload.bodyMarkdown }
  }
  if (payload.kind === 'task') {
    return {
      ...EMPTY_FORM,
      kind: 'task',
      title: payload.title,
      bodyMarkdown: payload.bodyMarkdown,
      planDate: payload.planDate ?? '',
      dueDate: payload.dueDate ?? ''
    }
  }
  if (payload.kind === 'timed-schedule') {
    return {
      ...EMPTY_FORM,
      kind: 'timed-schedule',
      title: payload.title,
      bodyMarkdown: payload.bodyMarkdown,
      timedStart: payload.startAtUtc ? toDateTimeLocal(payload.startAtUtc, timeZone) : '',
      timedEnd: payload.endAtUtc ? toDateTimeLocal(payload.endAtUtc, timeZone) : ''
    }
  }
  return {
    ...EMPTY_FORM,
    kind: 'all-day-schedule',
    title: payload.title,
    bodyMarkdown: payload.bodyMarkdown,
    allDayStart: payload.startDate ?? '',
    allDayEnd: payload.endDateExclusive ?? ''
  }
}

interface CaptureViewProps {
  bootstrap: BootstrapSnapshot
  copy: Copy
}

export function CaptureView({ bootstrap, copy }: CaptureViewProps): React.JSX.Element {
  const [form, setForm] = useState<CaptureForm>(EMPTY_FORM)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [saveError, setSaveError] = useState<string>()
  const [submitState, setSubmitState] = useState<'idle' | 'creating' | 'created' | 'failed'>('idle')
  const [submitError, setSubmitError] = useState<string>()
  const [initialized, setInitialized] = useState(false)
  const revisionRef = useRef(0)
  const versionRef = useRef(0)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const activeRef = useRef(true)
  const formRef = useRef(form)
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true))

  useEffect(() => {
    formRef.current = form
  }, [form])

  const applyDraft = useCallback((draft: Draft | null): void => {
    if (draft) {
      revisionRef.current = draft.revision
      setForm(formFromDraft(draft, bootstrap.appTimeZone))
      setSaveState('saved')
    } else {
      revisionRef.current = 0
      setForm(EMPTY_FORM)
      setSaveState('unsaved')
    }
    dirtyRef.current = false
    setSaveError(undefined)
    setInitialized(true)
  }, [bootstrap.appTimeZone])

  const readDraft = useCallback(async (): Promise<void> => {
    try {
      const result = await window.quietDesk.drafts.get({
        requestId: newRequestId(),
        payload: { id: QUICK_CAPTURE_DRAFT_ID }
      })
      if (!activeRef.current) return
      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          applyDraft(null)
        } else {
          setSaveState('failed')
          setSaveError(ipcError(result))
          setInitialized(true)
        }
        return
      }
      applyDraft(result.value)
    } catch (reason) {
      if (!activeRef.current) return
      setSaveState('failed')
      setSaveError(unknownError(reason))
      setInitialized(true)
    }
  }, [applyDraft])

  const persistSnapshot = useCallback((snapshot: CaptureForm, version: number): Promise<boolean> => {
    const payload = toPayload(snapshot, bootstrap.appTimeZone)

    const queued = saveQueueRef.current.catch(() => false).then(async () => {
      if (!activeRef.current) return false
      savingRef.current = true
      setSaveState('saving')
      setSaveError(undefined)
      try {
        const result = await window.quietDesk.drafts.save({
          requestId: newRequestId(),
          idempotencyKey: newRequestId(),
          payload: {
            id: QUICK_CAPTURE_DRAFT_ID,
            expectedRevision: revisionRef.current,
            captureKind: captureKind(snapshot.kind),
            payload
          }
        })
        if (!result.ok) {
          setSaveState(result.error.code === 'CONFLICT' ? 'conflict' : 'failed')
          setSaveError(ipcError(result))
          return false
        }
        revisionRef.current = result.value.revision
        if (version === versionRef.current) {
          dirtyRef.current = false
          setSaveState('saved')
        } else {
          setSaveState('unsaved')
        }
        return true
      } catch (reason) {
        setSaveState('failed')
        setSaveError(unknownError(reason))
        return false
      } finally {
        savingRef.current = false
      }
    })
    saveQueueRef.current = queued
    return queued
  }, [bootstrap.appTimeZone])

  useEffect(() => {
    activeRef.current = true
    const unsubscribe = window.quietDesk.changes.subscribe((event) => {
      if (!event.topics.includes('drafts')) return
      if (savingRef.current) return
      if (dirtyRef.current) {
        setSaveState('conflict')
        return
      }
      void readDraft()
    })
    void readDraft()
    return () => {
      activeRef.current = false
      unsubscribe()
    }
  }, [readDraft])

  useEffect(() => {
    if (!initialized || !dirtyRef.current) return
    const version = versionRef.current
    const timer = window.setTimeout(() => {
      void persistSnapshot(formRef.current, version)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [form, initialized, persistSnapshot])

  const updateForm = (change: Partial<CaptureForm>): void => {
    versionRef.current += 1
    dirtyRef.current = true
    setSaveState('unsaved')
    setSaveError(undefined)
    setSubmitState('idle')
    setSubmitError(undefined)
    setForm((current) => ({ ...current, ...change }))
  }

  const saveNow = (): Promise<boolean> => persistSnapshot(formRef.current, versionRef.current)

  const createEntity = async (): Promise<void> => {
    const payload = toPayload(formRef.current, bootstrap.appTimeZone)
    const invalidEntity =
      (payload.kind !== 'note' && !payload.title.trim()) ||
      (payload.kind === 'timed-schedule' && (
        payload.startAtUtc === null || payload.endAtUtc === null || payload.startAtUtc >= payload.endAtUtc
      )) ||
      (payload.kind === 'all-day-schedule' && (
        payload.startDate === null || payload.endDateExclusive === null ||
        payload.startDate >= payload.endDateExclusive
      ))
    if (invalidEntity) {
      setSubmitState('failed')
      setSubmitError(copy.invalidForm)
      return
    }
    if (payload.kind === 'note' && !payload.title.trim() && !payload.bodyMarkdown.trim()) {
      setSubmitState('failed')
      setSubmitError(copy.noteNeedsContent)
      return
    }

    setSubmitState('creating')
    setSubmitError(undefined)
    try {
      const common = { requestId: newRequestId(), idempotencyKey: newRequestId() }
      const id = newRequestId()
      const result = payload.kind === 'note'
        ? await window.quietDesk.notes.create({
          ...common,
          payload: { id, title: payload.title, bodyMarkdown: payload.bodyMarkdown }
        })
        : payload.kind === 'task'
          ? await window.quietDesk.tasks.create({
            ...common,
            payload: {
              id,
              title: payload.title,
              bodyMarkdown: payload.bodyMarkdown,
              planDate: payload.planDate,
              dueDate: payload.dueDate
            }
          })
          : payload.kind === 'timed-schedule'
            ? await window.quietDesk.schedules.create({
              ...common,
              payload: {
                kind: 'timed',
                id,
                title: payload.title,
                bodyMarkdown: payload.bodyMarkdown,
                startAtUtc: payload.startAtUtc!,
                endAtUtc: payload.endAtUtc!
              }
            })
            : await window.quietDesk.schedules.create({
              ...common,
              payload: {
                kind: 'all-day',
                id,
                title: payload.title,
                bodyMarkdown: payload.bodyMarkdown,
                startDate: payload.startDate!,
                endDateExclusive: payload.endDateExclusive!
              }
            })

      if (!result.ok) {
        setSubmitState('failed')
        setSubmitError(ipcError(result))
        return
      }

      setSubmitState('created')
      versionRef.current += 1
      dirtyRef.current = true
      setForm(EMPTY_FORM)
      formRef.current = EMPTY_FORM
      void persistSnapshot(EMPTY_FORM, versionRef.current)
    } catch (reason) {
      setSubmitState('failed')
      setSubmitError(unknownError(reason))
    }
  }

  const hide = async (): Promise<void> => {
    if (dirtyRef.current && !await saveNow()) return
    try {
      const result = await window.quietDesk.windows.hide({
        requestId: newRequestId(),
        payload: { target: 'capture' }
      })
      if (!result.ok) setSubmitError(ipcError(result))
    } catch (reason) {
      setSubmitError(unknownError(reason))
    }
  }

  const saveLabel = saveState === 'loading' ? copy.loading
    : saveState === 'saving' ? copy.saving
      : saveState === 'saved' ? `${copy.saved} · ${copy.revision(revisionRef.current)}`
        : saveState === 'failed' ? copy.saveFailed
          : saveState === 'incomplete' ? copy.draftIncomplete
            : saveState === 'conflict' ? copy.draftConflict
              : copy.unsaved

  return (
    <div className="capture-layout">
      <div className="segmented-control" data-testid="capture-kind" role="group" aria-label={copy.capture}>
        {([
          ['note', copy.note],
          ['task', copy.task],
          ['timed-schedule', copy.timedSchedule],
          ['all-day-schedule', copy.allDaySchedule]
        ] as const).map(([kind, label]) => (
          <button
            type="button"
            className={form.kind === kind ? 'active' : undefined}
            aria-pressed={form.kind === kind}
            key={kind}
            onClick={() => updateForm({ kind })}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="capture-card section-card">
        <label className="field-control">
          <span>{copy.title}</span>
          <input
            data-testid="capture-title"
            value={form.title}
            maxLength={500}
            autoComplete="off"
            onChange={(event) => updateForm({ title: event.target.value })}
          />
        </label>

        {form.kind === 'task' ? (
          <div className="field-grid two-columns">
            <label className="field-control">
              <span>{copy.planDate}</span>
              <input data-testid="capture-plan-date" type="date" value={form.planDate} onChange={(event) => updateForm({ planDate: event.target.value })} />
            </label>
            <label className="field-control">
              <span>{copy.dueDate}</span>
              <input data-testid="capture-due-date" type="date" value={form.dueDate} onChange={(event) => updateForm({ dueDate: event.target.value })} />
            </label>
          </div>
        ) : null}

        {form.kind === 'timed-schedule' ? (
          <div className="field-grid two-columns">
            <label className="field-control">
              <span>{copy.start}</span>
              <input data-testid="capture-start" type="datetime-local" value={form.timedStart} onChange={(event) => updateForm({ timedStart: event.target.value })} />
            </label>
            <label className="field-control">
              <span>{copy.end}</span>
              <input data-testid="capture-end" type="datetime-local" value={form.timedEnd} onChange={(event) => updateForm({ timedEnd: event.target.value })} />
            </label>
            <p className="field-hint full-column">{copy.scheduleTimeZoneHint(bootstrap.appTimeZone)}</p>
          </div>
        ) : null}

        {form.kind === 'all-day-schedule' ? (
          <div className="field-grid two-columns">
            <label className="field-control">
              <span>{copy.start}</span>
              <input data-testid="capture-start" type="date" value={form.allDayStart} onChange={(event) => updateForm({ allDayStart: event.target.value })} />
            </label>
            <label className="field-control">
              <span>{copy.end}</span>
              <input data-testid="capture-end" type="date" value={form.allDayEnd} onChange={(event) => updateForm({ allDayEnd: event.target.value })} />
            </label>
          </div>
        ) : null}

        <label className="field-control body-field">
          <span>{copy.details}</span>
          <textarea
            data-testid="capture-body"
            value={form.bodyMarkdown}
            rows={7}
            onChange={(event) => updateForm({ bodyMarkdown: event.target.value })}
          />
        </label>
      </section>

      <div className="capture-footer">
        <div>
          <p
            className={`save-state save-state-${saveState}`}
            data-testid="draft-save-state"
            data-state={saveState}
            aria-live="polite"
          >
            {saveLabel}
          </p>
          {saveError ? <p className="inline-error">{saveError}</p> : null}
          <p className="stage-note">{copy.captureStageNotice}</p>
        </div>
        <div className="button-row">
          <button type="button" className="button-ghost" data-testid="capture-close" onClick={() => void hide()}>{copy.close}</button>
          <button type="button" className="button-secondary" onClick={() => void saveNow()} disabled={saveState === 'saving'}>{copy.save}</button>
          <button
            type="button"
            className="button-accent"
            data-testid="capture-submit"
            disabled={submitState === 'creating' || !initialized}
            onClick={() => void createEntity()}
          >
            {submitState === 'creating' ? copy.creating : copy.create}
          </button>
        </div>
      </div>
      {submitState === 'created' ? <p className="success-banner" role="status">{copy.created}</p> : null}
      {submitState === 'failed' ? <p className="inline-error" role="alert">{copy.operationFailed}: {submitError}</p> : null}
    </div>
  )
}
