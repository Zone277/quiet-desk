import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())

function spyOnFormatterConstruction() {
  const Original = Intl.DateTimeFormat
  return vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new Original(locales, options)
  })
}

describe('date formatter reuse', () => {
  it('constructs once for repeated list items and wall-time conversion iterations', async () => {
    const { formatInstant, fromDateTimeLocal } = await import('./ui-utils')
    const constructor = spyOnFormatterConstruction()
    for (let index = 0; index < 100; index += 1) {
      formatInstant('2026-10-01T12:00:00.000Z', 'zh-CN', 'Asia/Shanghai')
    }
    expect(constructor).toHaveBeenCalledTimes(1)
    expect(fromDateTimeLocal('2026-10-01T20:00', 'Asia/Shanghai')).toBe('2026-10-01T12:00:00.000Z')
    expect(constructor).toHaveBeenCalledTimes(2)
  })

  it('preserves locale, timezone and formatting options independently', async () => {
    const { formatInstant, formatDateOnly, toDateTimeLocal } = await import('./ui-utils')
    const instant = '2026-10-01T20:30:00.000Z'
    for (const locale of ['zh-CN', 'en-US'] as const) {
      for (const timeZone of ['Asia/Shanghai', 'America/New_York', 'UTC']) {
        expect(formatInstant(instant, locale, timeZone)).toBe(new Intl.DateTimeFormat(locale, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone
        }).format(new Date(instant)))
      }
      expect(formatDateOnly('2026-10-01', locale)).toBe(new Intl.DateTimeFormat(locale, {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
      }).format(new Date('2026-10-01T12:00:00Z')))
    }
    expect(toDateTimeLocal(instant, 'Asia/Shanghai')).toBe('2026-10-02T04:30')
    expect(toDateTimeLocal(instant, 'America/New_York')).toBe('2026-10-01T16:30')
  })

  it('retains DST gap rejection and date-specific offsets when reusing a formatter', async () => {
    const { fromDateTimeLocal } = await import('./ui-utils')
    expect(fromDateTimeLocal('2026-03-08T02:30', 'America/New_York')).toBeNull()
    expect(fromDateTimeLocal('2026-01-01T12:00', 'America/New_York')).toBe('2026-01-01T17:00:00.000Z')
    expect(fromDateTimeLocal('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z')
  })

  it('evicts least recently used entries and does not cache failed construction', async () => {
    const { formatInstant } = await import('./ui-utils')
    const constructor = spyOnFormatterConstruction()
    const format = (zone: string) => formatInstant('2026-10-01T12:00:00.000Z', 'en-US', zone)
    const zones = Intl.supportedValuesOf('timeZone').slice(0, 33)
    for (const zone of zones.slice(0, 32)) format(zone)
    format(zones[0]!) // Refresh the oldest entry.
    expect(constructor).toHaveBeenCalledTimes(32)
    format(zones[32]!)
    format(zones[0]!)
    expect(constructor).toHaveBeenCalledTimes(33)
    format(zones[1]!) // The untouched entry was evicted.
    expect(constructor).toHaveBeenCalledTimes(34)
    expect(() => format('Invalid/Zone')).toThrow(RangeError)
    expect(() => format('Invalid/Zone')).toThrow(RangeError)
    expect(constructor).toHaveBeenCalledTimes(36)
  })
})
