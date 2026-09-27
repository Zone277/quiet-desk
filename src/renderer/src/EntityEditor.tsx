import { useEffect, useRef, useState } from 'react'
import type { BootstrapSnapshot } from '../../shared/ipc-contract'
import { updateNoteRequestSchema, updateTaskRequestSchema, rescheduleTaskRequestSchema, updateScheduleRequestSchema } from '../../shared/ipc-contract'
import type { EntityRecord } from '../../shared/model'
import type { Copy } from './i18n'
import { fromDateTimeLocal, toDateTimeLocal, ipcError, newRequestId, unknownError } from './ui-utils'

interface EditForm { title: string; bodyMarkdown: string; planDate: string; dueDate: string; start: string; end: string }
interface Props {
  record: EntityRecord; bootstrap: BootstrapSnapshot; copy: Copy
  onSaved(record: EntityRecord): void; onCancel(): void; onBlockedChange(blocked: boolean): void
}
function initialForm(record: EntityRecord, timeZone: string): EditForm {
  return {
    title: record.value.title, bodyMarkdown: record.value.bodyMarkdown,
    planDate: record.type === 'task' ? record.value.planDate ?? '' : '',
    dueDate: record.type === 'task' ? record.value.dueDate ?? '' : '',
    start: record.type !== 'schedule' ? '' : record.value.kind === 'all-day' ? record.value.startDate : toDateTimeLocal(record.value.startAtUtc, timeZone),
    end: record.type !== 'schedule' ? '' : record.value.kind === 'all-day' ? record.value.endDateExclusive : toDateTimeLocal(record.value.endAtUtc, timeZone)
  }
}

export function EntityEditor({ record, bootstrap, copy, onSaved, onCancel, onBlockedChange }: Props): React.JSX.Element {
  // Keep the exact revision opened, including across external detail refreshes. Conflicts retain input.
  const base = useRef(record)
  const original = useRef(initialForm(record, bootstrap.appTimeZone))
  const [form, setForm] = useState(original.current)
  const formRef = useRef(form)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const active = useRef(true)
  const [error, setError] = useState<string>()
  const retry = useRef<{ signature: string; key: string } | undefined>(undefined)
  const dirty = JSON.stringify(form) !== JSON.stringify(original.current)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    active.current = true
    return () => { active.current = false; onBlockedChange(false) }
  }, [onBlockedChange])
  useEffect(() => window.quietDesk.app.subscribeQuitPreparation(async () => {
    if (!dirtyRef.current && !inFlight.current) return true
    setError(copy.unsavedEdit)
    return false
  }), [copy.unsavedEdit])

  const change = (patch: Partial<EditForm>): void => {
    if (inFlight.current) return
    const next = { ...formRef.current, ...patch }
    formRef.current = next
    dirtyRef.current = JSON.stringify(next) !== JSON.stringify(original.current)
    onBlockedChange(dirtyRef.current)
    setForm(next); setError(undefined)
  }
  const save = async (): Promise<void> => {
    if (inFlight.current) return
    const current = formRef.current
    const target = base.current
    if (current.bodyMarkdown.length > 1_000_000) { setError(copy.markdownTooLong); return }
    const signature = JSON.stringify(current)
    const key = retry.current?.signature === signature ? retry.current.key : newRequestId()
    retry.current = { signature, key }
    const envelope = { requestId: newRequestId(), idempotencyKey: key }
    const common = { id: target.value.id, expectedRevision: target.value.revision, title: current.title, bodyMarkdown: current.bodyMarkdown }
    inFlight.current = true; setSaving(true); onBlockedChange(true); setError(undefined)
    try {
      let updated: EntityRecord
      if (target.type === 'note') {
        const request = updateNoteRequestSchema.safeParse({ ...envelope, payload: common })
        if (!request.success) { setError(copy.invalidForm); return }
        const result = await window.quietDesk.notes.update(request.data)
        if (!result.ok) { setError(ipcError(result)); return }
        updated = { type: 'note', value: result.value }
      } else if (target.type === 'task') {
        const dates = { planDate: current.planDate || null, dueDate: current.dueDate || null }
        // Date-only edits use the existing atomic reschedule operation; no renderer qualification rules.
        if (current.title === target.value.title && current.bodyMarkdown === target.value.bodyMarkdown) {
          const request = rescheduleTaskRequestSchema.safeParse({ ...envelope, payload: { id: common.id, expectedRevision: common.expectedRevision, ...dates } })
          if (!request.success) { setError(copy.invalidForm); return }
          const result = await window.quietDesk.tasks.reschedule(request.data)
          if (!result.ok) { setError(ipcError(result)); return }
          updated = { type: 'task', value: result.value }
        } else {
          const request = updateTaskRequestSchema.safeParse({ ...envelope, payload: { ...common, ...dates } })
          if (!request.success) { setError(copy.invalidForm); return }
          const result = await window.quietDesk.tasks.update(request.data)
          if (!result.ok) { setError(ipcError(result)); return }
          updated = { type: 'task', value: result.value }
        }
      } else {
        const schedule = target.value
        const boundaries = schedule.kind === 'all-day'
          ? { kind: 'all-day' as const, startDate: current.start, endDateExclusive: current.end }
          : { kind: 'timed' as const,
              startAtUtc: current.start === original.current.start ? schedule.startAtUtc : fromDateTimeLocal(current.start, bootstrap.appTimeZone),
              endAtUtc: current.end === original.current.end ? schedule.endAtUtc : fromDateTimeLocal(current.end, bootstrap.appTimeZone) }
        const request = updateScheduleRequestSchema.safeParse({ ...envelope, payload: { ...common, ...boundaries } })
        if (!request.success) { setError(copy.invalidForm); return }
        const result = await window.quietDesk.schedules.update(request.data)
        if (!result.ok) { setError(ipcError(result)); return }
        updated = { type: 'schedule', value: result.value }
      }
      if (active.current) { dirtyRef.current = false; onBlockedChange(false); onSaved(updated) }
    } catch (reason) {
      if (active.current) setError(unknownError(reason))
    } finally {
      inFlight.current = false
      if (active.current) { setSaving(false); onBlockedChange(dirtyRef.current) }
    }
  }

  return <section className="entity-editor" aria-label={copy.edit}>
    <label className="field-control"><span>{copy.title}</span><input data-testid="entity-edit-title" value={form.title} maxLength={500} disabled={saving} onChange={(event) => change({ title: event.target.value })} /></label>
    <label className="field-control"><span>{copy.details}</span><textarea data-testid="entity-edit-body" value={form.bodyMarkdown} rows={8} disabled={saving} onChange={(event) => change({ bodyMarkdown: event.target.value })} /></label>
    {base.current.type === 'task' ? <div className="field-grid two-columns">
      <label className="field-control"><span>{copy.planDate}</span><input data-testid="entity-edit-plan-date" type="date" value={form.planDate} disabled={saving} onChange={(event) => change({ planDate: event.target.value })} /></label>
      <label className="field-control"><span>{copy.dueDate}</span><input data-testid="entity-edit-due-date" type="date" value={form.dueDate} disabled={saving} onChange={(event) => change({ dueDate: event.target.value })} /></label>
    </div> : null}
    {base.current.type === 'schedule' ? <div className="field-grid two-columns">
      <label className="field-control"><span>{copy.start}</span><input data-testid="entity-edit-start" type={base.current.value.kind === 'all-day' ? 'date' : 'datetime-local'} value={form.start} disabled={saving} onChange={(event) => change({ start: event.target.value })} /></label>
      <label className="field-control"><span>{base.current.value.kind === 'all-day' ? copy.endExclusive : copy.end}</span><input data-testid="entity-edit-end" type={base.current.value.kind === 'all-day' ? 'date' : 'datetime-local'} value={form.end} disabled={saving} onChange={(event) => change({ end: event.target.value })} /></label>
      {base.current.value.kind === 'timed' ? <p className="field-hint full-column">{copy.scheduleTimeZoneHint(bootstrap.appTimeZone)}</p> : null}
    </div> : null}
    {error ? <p className="inline-error" data-testid="entity-edit-error" role="alert">{error}</p> : null}
    <div className="button-row">
      <button type="button" className="button-secondary" data-testid="entity-edit-cancel" disabled={saving} onClick={() => { dirtyRef.current = false; onBlockedChange(false); onCancel() }}>{copy.cancel}</button>
      <button type="button" className="button-accent" data-testid="entity-edit-save" disabled={saving} onClick={() => void save()}>{saving ? copy.saving : copy.saveChanges}</button>
    </div>
  </section>
}
