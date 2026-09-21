import type { IpcFailure, Locale } from '../../shared/ipc-contract'
import type { DateOnly, EntityRecord, Schedule } from '../../shared/model'

export function newRequestId(): string {
  return crypto.randomUUID()
}

export function ipcError(result: IpcFailure): string {
  return `${result.error.code}: ${result.error.message}`
}

export function unknownError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function formatDateOnly(value: DateOnly, locale: Locale): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)))
}

export function formatInstant(value: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  }).format(new Date(value))
}

export function formatSchedule(schedule: Schedule, locale: Locale, timeZone: string): string {
  if (schedule.kind === 'all-day') {
    return `${formatDateOnly(schedule.startDate, locale)} – ${formatDateOnly(schedule.endDateExclusive, locale)}`
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  })
  return `${formatter.format(new Date(schedule.startAtUtc))} – ${formatter.format(new Date(schedule.endAtUtc))}`
}

export function entityTitle(record: EntityRecord): string {
  return record.value.title.trim() || record.value.bodyMarkdown.trim().split(/\r?\n/u)[0]?.slice(0, 80) || 'Untitled'
}

export function entityRevision(record: EntityRecord): number {
  return record.value.revision
}

export function nextDate(value: DateOnly, offset: number): DateOnly {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function zonedDateTimeParts(instant: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant).map((part) => [part.type, part.value]))
}

export function toDateTimeLocal(utc: string, timeZone: string): string {
  const parts = zonedDateTimeParts(new Date(utc), timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function fromDateTimeLocal(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const targetWallTime = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0, 0)
  let candidate = targetWallTime
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedDateTimeParts(new Date(candidate), timeZone)
    const representedWallTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second), 0
    )
    const delta = targetWallTime - representedWallTime
    candidate += delta
    if (delta === 0) break
  }
  const verified = zonedDateTimeParts(new Date(candidate), timeZone)
  if (
    Number(verified.year) !== year || Number(verified.month) !== month ||
    Number(verified.day) !== day || Number(verified.hour) !== hour ||
    Number(verified.minute) !== minute
  ) return null
  return new Date(candidate).toISOString()
}
