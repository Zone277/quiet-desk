import { describe, expect, test } from 'vitest'
import { FixedClock, dateInTimeZone, nowUtc } from '../../src/shared/clock'
import {
  allDayScheduleSchema,
  captureDraftPayloadSchema,
  dateOnlySchema,
  taskSchema,
  timedScheduleSchema,
  utcInstantSchema
} from '../../src/shared/model'
import {
  bootstrapRequestSchema,
  createNoteRequestSchema,
  permanentlyDeleteEntityRequestSchema,
  saveDraftRequestSchema,
  updateTaskRequestSchema
} from '../../src/shared/ipc-contract'

const id = '01234567-89ab-4def-8abc-0123456789ab'
const instant = '2026-09-21T08:15:30.000Z'

describe('v2 shared contract', () => {
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
    expect(result.revision).toBe(1)
  })

  test('validates typed drafts and exact permanent-delete confirmation', () => {
    expect(captureDraftPayloadSchema.safeParse({
      kind: 'task',
      title: '草稿',
      bodyMarkdown: '',
      planDate: null,
      dueDate: null
    }).success).toBe(true)
    expect(saveDraftRequestSchema.safeParse({
      requestId: id,
      idempotencyKey: '11234567-89ab-4def-8abc-0123456789ab',
      payload: {
        id,
        expectedRevision: 0,
        captureKind: 'note',
        payload: { kind: 'task', title: 'mismatch', bodyMarkdown: '', planDate: null, dueDate: null }
      }
    }).success).toBe(false)
    expect(permanentlyDeleteEntityRequestSchema.safeParse({
      requestId: id,
      idempotencyKey: '11234567-89ab-4def-8abc-0123456789ab',
      payload: {
        entity: { type: 'task', id },
        expectedRevision: 2,
        confirmedEntityId: '21234567-89ab-4def-8abc-0123456789ab'
      }
    }).success).toBe(false)
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

  test('requires an explicit positive revision for entity updates', () => {
    const base = {
      requestId: id,
      idempotencyKey: '11234567-89ab-4def-8abc-0123456789ab',
      payload: {
        id,
        title: 'explicit revision',
        bodyMarkdown: '',
        planDate: null,
        dueDate: null
      }
    }
    expect(updateTaskRequestSchema.safeParse(base).success).toBe(false)
    expect(updateTaskRequestSchema.safeParse({
      ...base,
      payload: { ...base.payload, expectedRevision: 0 }
    }).success).toBe(false)
    expect(updateTaskRequestSchema.safeParse({
      ...base,
      payload: { ...base.payload, expectedRevision: 1 }
    }).success).toBe(true)
  })

  test('uses an injectable clock without changing the system clock', () => {
    const clock = new FixedClock('2026-09-21T16:30:00.000Z')
    expect(nowUtc(clock)).toBe('2026-09-21T16:30:00.000Z')
    expect(dateInTimeZone(clock, 'Asia/Shanghai')).toBe('2026-09-22')
    expect(dateInTimeZone(clock, 'UTC')).toBe('2026-09-21')
  })
})
