import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { BootstrapSnapshot } from '../../shared/ipc-contract'
import type { CaptureDraftPayload, CaptureKind, Draft } from '../../shared/model'
import type { Copy } from './i18n'
import { MarkdownView } from './MarkdownView'
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

interface SaveAttempt {
  editSeq: number
  idempotencyKey: string
  snapshot: CaptureForm
}

interface SubmitAttempt {
  draftRevision: number
  entityId: string
  idempotencyKey: string
}

type SaveState = 'loading' | 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict'

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

function emptyForm(): CaptureForm {
  return { ...EMPTY_FORM }
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
    return {
      kind: 'timed-schedule',
      title: form.title,
      bodyMarkdown: form.bodyMarkdown,
      startAtUtc: fromDateTimeLocal(form.timedStart, timeZone),
      endAtUtc: fromDateTimeLocal(form.timedEnd, timeZone)
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
  const [form, setForm] = useState<CaptureForm>(() => emptyForm())
  const [editorMode, setEditorMode] = useState<'source' | 'preview'>('source')
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [saveError, setSaveError] = useState<string>()
  const [submitState, setSubmitState] = useState<'idle' | 'creating' | 'failed'>('idle')
  const [submitError, setSubmitError] = useState<string>()
  const [initialized, setInitialized] = useState(false)

  const revisionRef = useRef(0)
  const editSeqRef = useRef(0)
  const persistedEditSeqRef = useRef(0)
  const dirtyRef = useRef(false)
  const initializedRef = useRef(false)
  const activeRef = useRef(true)
  const composingRef = useRef(false)
  const formRef = useRef(form)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const writeInFlightRef = useRef<Promise<boolean> | null>(null)
  const blockedSaveAttemptRef = useRef<SaveAttempt | undefined>(undefined)
  const submitAttemptRef = useRef<SubmitAttempt | undefined>(undefined)
  const submitInFlightRef = useRef<Promise<void> | null>(null)
  const hideInFlightRef = useRef<Promise<void> | null>(null)
  const readGenerationRef = useRef(0)

  const applyDraft = useCallback((draft: Draft | null): void => {
    const nextForm = draft ? formFromDraft(draft, bootstrap.appTimeZone) : emptyForm()
    revisionRef.current = draft?.revision ?? 0
    editSeqRef.current = 0
    persistedEditSeqRef.current = 0
    dirtyRef.current = false
    blockedSaveAttemptRef.current = undefined
    submitAttemptRef.current = undefined
    formRef.current = nextForm
    setForm(nextForm)
    setSaveState(draft ? 'saved' : 'unsaved')
    setSaveError(undefined)
    initializedRef.current = true
    setInitialized(true)
  }, [bootstrap.appTimeZone])

  const readDraft = useCallback(async (): Promise<void> => {
    const generation = ++readGenerationRef.current
    try {
      const result = await window.quietDesk.drafts.get({
        requestId: newRequestId(),
        payload: { id: QUICK_CAPTURE_DRAFT_ID }
      })
      if (!activeRef.current || generation !== readGenerationRef.current) return
      if (dirtyRef.current) {
        setSaveState('conflict')
        setSaveError(copy.draftConflict)
        return
      }
      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') applyDraft(null)
        else {
          setSaveState('failed')
          setSaveError(ipcError(result))
          initializedRef.current = true
          setInitialized(true)
        }
        return
      }
      applyDraft(result.value)
    } catch (reason) {
      if (!activeRef.current || generation !== readGenerationRef.current) return
      setSaveState('failed')
      setSaveError(unknownError(reason))
      initializedRef.current = true
      setInitialized(true)
    }
  }, [applyDraft, copy.draftConflict])

  const persistLatestSnapshot = useCallback((): Promise<boolean> => {
    if (!initializedRef.current || !dirtyRef.current) return Promise.resolve(true)
    if (writeInFlightRef.current) return writeInFlightRef.current

    const attempt = blockedSaveAttemptRef.current ?? {
      editSeq: editSeqRef.current,
      idempotencyKey: newRequestId(),
      snapshot: { ...formRef.current }
    }
    blockedSaveAttemptRef.current = attempt
    setSaveState('saving')
    setSaveError(undefined)

    const operation = (async (): Promise<boolean> => {
      try {
        const result = await window.quietDesk.drafts.save({
          requestId: newRequestId(),
          idempotencyKey: attempt.idempotencyKey,
          payload: {
            id: QUICK_CAPTURE_DRAFT_ID,
            expectedRevision: revisionRef.current,
            captureKind: captureKind(attempt.snapshot.kind),
            payload: toPayload(attempt.snapshot, bootstrap.appTimeZone)
          }
        })
        if (!activeRef.current) return false
        if (!result.ok) {
          if (editSeqRef.current !== attempt.editSeq) blockedSaveAttemptRef.current = undefined
          setSaveState(result.error.code === 'CONFLICT' ? 'conflict' : 'failed')
          setSaveError(ipcError(result))
          return false
        }

        revisionRef.current = result.value.revision
        persistedEditSeqRef.current = attempt.editSeq
        blockedSaveAttemptRef.current = undefined
        if (editSeqRef.current === attempt.editSeq) {
          dirtyRef.current = false
          setSaveState('saved')
        } else {
          setSaveState('unsaved')
        }
        return true
      } catch (reason) {
        if (!activeRef.current) return false
        if (editSeqRef.current !== attempt.editSeq) blockedSaveAttemptRef.current = undefined
        setSaveState('failed')
        setSaveError(unknownError(reason))
        return false
      } finally {
        writeInFlightRef.current = null
      }
    })()

    writeInFlightRef.current = operation
    return operation
  }, [bootstrap.appTimeZone])

  const flushLatestDraft = useCallback(async (): Promise<boolean> => {
    while (activeRef.current && dirtyRef.current) {
      const saved = await persistLatestSnapshot()
      if (!saved) return false
      if (persistedEditSeqRef.current >= editSeqRef.current) return true
    }
    return true
  }, [persistLatestSnapshot])

  useEffect(() => {
    activeRef.current = true
    const unsubscribeChanges = window.quietDesk.changes.subscribe((event) => {
      if (!event.topics.includes('drafts')) return
      if (writeInFlightRef.current || submitInFlightRef.current) return
      if (dirtyRef.current) {
        setSaveState('conflict')
        setSaveError(copy.draftConflict)
        return
      }
      void readDraft()
    })
    const unsubscribeContext = window.quietDesk.windows.subscribeContext((context) => {
      if (context.target !== 'capture' || !context.focusEditor) return
      setEditorMode('source')
      window.requestAnimationFrame(() => editorRef.current?.focus())
    })
    void readDraft()
    return () => {
      activeRef.current = false
      readGenerationRef.current += 1
      unsubscribeChanges()
      unsubscribeContext()
    }
  }, [copy.draftConflict, readDraft])

  useEffect(() => {
    if (!initialized || !dirtyRef.current) return
    const timer = window.setTimeout(() => { void flushLatestDraft() }, 800)
    return () => window.clearTimeout(timer)
  }, [flushLatestDraft, form, initialized])

  const updateForm = (change: Partial<CaptureForm>): void => {
    const nextForm = { ...formRef.current, ...change }
    editSeqRef.current += 1
    dirtyRef.current = true
    submitAttemptRef.current = undefined
    formRef.current = nextForm
    setForm(nextForm)
    setSaveState('unsaved')
    setSaveError(undefined)
    setSubmitState('idle')
    setSubmitError(undefined)
  }

  const hideWindow = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.quietDesk.windows.hide({
        requestId: newRequestId(),
        payload: { target: 'capture' }
      })
      if (!result.ok) {
        setSubmitError(ipcError(result))
        return false
      }
      return true
    } catch (reason) {
      setSubmitError(unknownError(reason))
      return false
    }
  }, [])

  const saveAndHide = useCallback((): Promise<void> => {
    if (hideInFlightRef.current || submitInFlightRef.current) {
      return hideInFlightRef.current ?? Promise.resolve()
    }
    const operation = (async (): Promise<void> => {
      setSubmitError(undefined)
      if (!await flushLatestDraft()) return
      await hideWindow()
    })().finally(() => { hideInFlightRef.current = null })
    hideInFlightRef.current = operation
    return operation
  }, [flushLatestDraft, hideWindow])

  const submitDraft = useCallback((): Promise<void> => {
    if (submitInFlightRef.current) return submitInFlightRef.current

    const operation = (async (): Promise<void> => {
      setSubmitState('creating')
      setSubmitError(undefined)
      if (!await flushLatestDraft()) {
        setSubmitState('failed')
        return
      }

      const draftRevision = revisionRef.current
      if (draftRevision <= 0) {
        setSubmitState('failed')
        setSubmitError(copy.noteNeedsContent)
        return
      }

      const attempt = submitAttemptRef.current?.draftRevision === draftRevision
        ? submitAttemptRef.current
        : { draftRevision, entityId: newRequestId(), idempotencyKey: newRequestId() }
      submitAttemptRef.current = attempt

      try {
        const result = await window.quietDesk.drafts.submit({
          requestId: newRequestId(),
          idempotencyKey: attempt.idempotencyKey,
          payload: {
            draftId: QUICK_CAPTURE_DRAFT_ID,
            expectedRevision: attempt.draftRevision,
            entityId: attempt.entityId
          }
        })
        if (!activeRef.current) return
        if (!result.ok) {
          setSubmitState('failed')
          setSubmitError(ipcError(result))
          return
        }

        const nextForm = emptyForm()
        submitAttemptRef.current = undefined
        blockedSaveAttemptRef.current = undefined
        revisionRef.current = 0
        editSeqRef.current = 0
        persistedEditSeqRef.current = 0
        dirtyRef.current = false
        formRef.current = nextForm
        setForm(nextForm)
        setEditorMode('source')
        setSaveState('unsaved')
        setSaveError(undefined)
        setSubmitState('idle')
        await hideWindow()
      } catch (reason) {
        if (!activeRef.current) return
        setSubmitState('failed')
        setSubmitError(unknownError(reason))
      }
    })().finally(() => { submitInFlightRef.current = null })

    submitInFlightRef.current = operation
    return operation
  }, [copy.noteNeedsContent, flushLatestDraft, hideWindow])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      void submitDraft()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      void saveAndHide()
    }
  }

  const saveLabel = saveState === 'loading' ? copy.loading
    : saveState === 'saving' ? copy.saving
      : saveState === 'saved' ? `${copy.saved} · ${copy.revision(revisionRef.current)}`
        : saveState === 'failed' ? copy.saveFailed
          : saveState === 'conflict' ? copy.draftConflict
            : copy.unsaved
  const controlsDisabled = !initialized || submitState === 'creating'

  return (
    <div
      className="capture-layout"
      onKeyDownCapture={handleKeyDown}
      onCompositionStartCapture={() => { composingRef.current = true }}
      onCompositionEndCapture={() => { composingRef.current = false }}
    >
      <div className="segmented-control" data-testid="capture-kind" role="group" aria-label={copy.capture}>
        {([
          ['note', copy.note],
          ['task', copy.task],
          ['timed-schedule', copy.timedSchedule],
          ['all-day-schedule', copy.allDaySchedule]
        ] as const).map(([kind, label]) => (
          <button type="button" className={form.kind === kind ? 'active' : undefined} aria-pressed={form.kind === kind} disabled={controlsDisabled} key={kind} onClick={() => updateForm({ kind })}>
            {label}
          </button>
        ))}
      </div>

      <section className="capture-card section-card">
        <label className="field-control">
          <span>{copy.title}</span>
          <input data-testid="capture-title" value={form.title} maxLength={500} autoComplete="off" disabled={controlsDisabled} onChange={(event) => updateForm({ title: event.target.value })} />
        </label>

        {form.kind === 'task' ? (
          <div className="field-grid two-columns">
            <label className="field-control"><span>{copy.planDate}</span><input data-testid="capture-plan-date" type="date" value={form.planDate} disabled={controlsDisabled} onChange={(event) => updateForm({ planDate: event.target.value })} /></label>
            <label className="field-control"><span>{copy.dueDate}</span><input data-testid="capture-due-date" type="date" value={form.dueDate} disabled={controlsDisabled} onChange={(event) => updateForm({ dueDate: event.target.value })} /></label>
          </div>
        ) : null}

        {form.kind === 'timed-schedule' ? (
          <div className="field-grid two-columns">
            <label className="field-control"><span>{copy.start}</span><input data-testid="capture-start" type="datetime-local" value={form.timedStart} disabled={controlsDisabled} onChange={(event) => updateForm({ timedStart: event.target.value })} /></label>
            <label className="field-control"><span>{copy.end}</span><input data-testid="capture-end" type="datetime-local" value={form.timedEnd} disabled={controlsDisabled} onChange={(event) => updateForm({ timedEnd: event.target.value })} /></label>
            <p className="field-hint full-column">{copy.scheduleTimeZoneHint(bootstrap.appTimeZone)}</p>
          </div>
        ) : null}

        {form.kind === 'all-day-schedule' ? (
          <div className="field-grid two-columns">
            <label className="field-control"><span>{copy.start}</span><input data-testid="capture-start" type="date" value={form.allDayStart} disabled={controlsDisabled} onChange={(event) => updateForm({ allDayStart: event.target.value })} /></label>
            <label className="field-control"><span>{copy.end}</span><input data-testid="capture-end" type="date" value={form.allDayEnd} disabled={controlsDisabled} onChange={(event) => updateForm({ allDayEnd: event.target.value })} /></label>
          </div>
        ) : null}

        <div className="field-control body-field">
          <div className="markdown-editor-heading">
            <span id="capture-body-label">{copy.details}</span>
            <div className="view-toggle" role="group" aria-label={copy.markdownViewMode}>
              <button type="button" className={editorMode === 'source' ? 'active' : undefined} aria-pressed={editorMode === 'source'} onClick={() => setEditorMode('source')}>{copy.source}</button>
              <button type="button" className={editorMode === 'preview' ? 'active' : undefined} aria-pressed={editorMode === 'preview'} onClick={() => setEditorMode('preview')}>{copy.preview}</button>
            </div>
          </div>
          {editorMode === 'source' ? (
            <textarea ref={editorRef} data-testid="capture-body" aria-labelledby="capture-body-label" value={form.bodyMarkdown} rows={7} disabled={controlsDisabled} onChange={(event) => updateForm({ bodyMarkdown: event.target.value })} />
          ) : <MarkdownView markdown={form.bodyMarkdown} copy={copy} className="capture-markdown-preview" />}
        </div>
      </section>

      <div className="capture-footer">
        <div>
          <p className={`save-state save-state-${saveState}`} data-testid="draft-save-state" data-state={saveState} aria-live="polite">{saveLabel}</p>
          {saveError ? <p className="inline-error">{saveError}</p> : null}
          <p className="stage-note">{copy.captureHint}</p>
        </div>
        <div className="button-row">
          <button type="button" className="button-ghost" data-testid="capture-close" disabled={submitState === 'creating'} onClick={() => void saveAndHide()}>{copy.close}</button>
          <button type="button" className="button-secondary" onClick={() => void flushLatestDraft()} disabled={saveState === 'saving' || controlsDisabled}>{copy.save}</button>
          <button type="button" className="button-accent" data-testid="capture-submit" disabled={controlsDisabled} onClick={() => void submitDraft()}>{submitState === 'creating' ? copy.creating : copy.create}</button>
        </div>
      </div>
      {submitState === 'failed' ? <p className="inline-error" role="alert">{copy.operationFailed}: {submitError}</p> : null}
    </div>
  )
}
