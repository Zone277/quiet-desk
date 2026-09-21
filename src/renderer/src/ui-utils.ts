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

export function toDateTimeLocal(utc: string): string {
  const date = new Date(utc)
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
