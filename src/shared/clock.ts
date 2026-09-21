import type { DateOnly, UtcInstant } from './model'

export interface Clock {
  now(): Date
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}

export class FixedClock implements Clock {
  private readonly instant: Date

  constructor(instant: string | Date) {
    this.instant = new Date(instant)
    if (!Number.isFinite(this.instant.getTime())) {
      throw new Error('FixedClock requires a valid instant')
    }
  }

  now(): Date {
    return new Date(this.instant.getTime())
  }
}

export function nowUtc(clock: Clock): UtcInstant {
  return clock.now().toISOString()
}

export function dateInTimeZone(clock: Clock, timeZone: string): DateOnly {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(clock.now())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
