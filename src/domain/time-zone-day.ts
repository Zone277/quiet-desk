import { dateOnlySchema, ianaTimeZoneSchema, type DateOnly, type UtcInstant } from '../shared/model'

const DAY_SEARCH_WINDOW_MS = 48 * 60 * 60 * 1000

export interface UtcDayBounds {
  startAtUtc: UtcInstant
  endAtUtc: UtcInstant
  nextDate: DateOnly
}

function calendarParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

export function dateForInstantInTimeZone(instant: string | Date, timeZone: string): DateOnly {
  const validatedTimeZone = ianaTimeZoneSchema.parse(timeZone)
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (!Number.isFinite(date.getTime())) {
    throw new Error('A valid instant is required')
  }
  const values = calendarParts(date, validatedTimeZone)
  return dateOnlySchema.parse(`${values.year}-${values.month}-${values.day}`)
}

export function nextDate(date: DateOnly): DateOnly {
  const validated = dateOnlySchema.parse(date)
  const [year, month, day] = validated.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1))
  return dateOnlySchema.parse(next.toISOString().slice(0, 10))
}

function firstInstantForDate(date: DateOnly, timeZone: string): Date {
  const target = dateOnlySchema.parse(date)
  const validatedTimeZone = ianaTimeZoneSchema.parse(timeZone)
  const nominalUtc = Date.parse(`${target}T00:00:00.000Z`)
  let low = nominalUtc - DAY_SEARCH_WINDOW_MS
  let high = nominalUtc + DAY_SEARCH_WINDOW_MS

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (dateForInstantInTimeZone(new Date(middle), validatedTimeZone) < target) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  const result = new Date(low)
  if (dateForInstantInTimeZone(result, validatedTimeZone) !== target) {
    throw new Error(`Calendar date ${target} does not exist in ${validatedTimeZone}`)
  }
  return result
}

export function utcDayBounds(date: DateOnly, timeZone: string): UtcDayBounds {
  const validatedDate = dateOnlySchema.parse(date)
  const validatedTimeZone = ianaTimeZoneSchema.parse(timeZone)
  const followingDate = nextDate(validatedDate)
  return {
    startAtUtc: firstInstantForDate(validatedDate, validatedTimeZone).toISOString(),
    endAtUtc: firstInstantForDate(followingDate, validatedTimeZone).toISOString(),
    nextDate: followingDate
  }
}
