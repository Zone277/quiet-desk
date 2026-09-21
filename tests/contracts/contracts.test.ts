import { describe, expect, test } from 'vitest'
import { FixedClock, dateInTimeZone, nowUtc } from '../../src/shared/clock'
import {
  allDayScheduleSchema,
  dateOnlySchema,
  taskSchema,
  timedScheduleSchema,
  utcInstantSchema
} from '../../src/shared/model'
import {
  bootstrapRequestSchema,
  createNoteRequestSchema
} from '../../src/shared/ipc-contract'

const id = '01234567-89ab-4def-8abc-0123456789ab'
const instant = '2026-09-21T08:15:30.000Z'

describe('v1 shared contract', () => {
  test('keeps UTC instants and date-only values distinct', () => {
    expect(utcInstantSchema.safeParse(instant).success).toBe(true)
    expect(utcInstantSchema.safeParse('2026-09-21').success).toBe(false)
    expect(dateOnlySchema.safeParse('2026-09-21').success).toBe(true)
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false)
    expect(dateOnlySchema.safeParse(instant).success).toBe(false)
  })

  test('keeps task plan, due and completion fields independent', () => {
    const result = taskSchema.parse({
      id,
      title: '计划 / deadline',
      bodyMarkdown: '- [ ] mixed input',
      planDate: '2026-09-21',
      dueDate: '2026-09-30',
      completedAtUtc: null,
      createdAtUtc: instant,
      updatedAtUtc: instant,
      deletedAtUtc: null
    })
    expect(result.planDate).not.toBe(result.dueDate)
    expect(result.completedAtUtc).toBeNull()
  })

  test('distinguishes timed and all-day half-open schedules', () => {
    expect(timedScheduleSchema.safeParse({
      id,
      kind: 'timed',
      title: '跨午夜',
      bodyMarkdown: '',
      startAtUtc: '2026-09-21T15:00:00.000Z',
      endAtUtc: '2026-09-22T01:00:00.000Z',
      createdAtUtc: instant,
      updatedAtUtc: instant,
      deletedAtUtc: null
    }).success).toBe(true)
    expect(allDayScheduleSchema.safeParse({
      id,
      kind: 'all-day',
      title: '日期段',
      bodyMarkdown: '',
      startDate: '2026-09-21',
      endDateExclusive: '2026-09-21',
      createdAtUtc: instant,
      updatedAtUtc: instant,
      deletedAtUtc: null
    }).success).toBe(false)
  })

  test('requires request and idempotency identifiers at the IPC boundary', () => {
    expect(bootstrapRequestSchema.safeParse({ requestId: id, payload: { windowKind: 'widget' } }).success).toBe(true)
    expect(createNoteRequestSchema.safeParse({
      requestId: id,
      payload: { id, title: '', bodyMarkdown: 'missing key' }
    }).success).toBe(false)
  })

  test('uses an injectable clock without changing the system clock', () => {
    const clock = new FixedClock('2026-09-21T16:30:00.000Z')
    expect(nowUtc(clock)).toBe('2026-09-21T16:30:00.000Z')
    expect(dateInTimeZone(clock, 'Asia/Shanghai')).toBe('2026-09-22')
    expect(dateInTimeZone(clock, 'UTC')).toBe('2026-09-21')
  })
})
