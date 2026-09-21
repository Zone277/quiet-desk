import { z } from 'zod'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isCanonicalUtcInstant(value: string): boolean {
  if (!UTC_INSTANT_PATTERN.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export const entityIdSchema = z.string().regex(ID_PATTERN, 'Expected a UUID')
export const dateOnlySchema = z.string().regex(DATE_ONLY_PATTERN).refine(isCalendarDate, 'Invalid calendar date')
export const utcInstantSchema = z.string().regex(UTC_INSTANT_PATTERN).refine(isCanonicalUtcInstant, 'Expected canonical UTC instant')
export const ianaTimeZoneSchema = z.string().min(1).max(100).refine(isIanaTimeZone, 'Expected an IANA time zone')
export const markdownSchema = z.string().max(1_000_000)
export const titleSchema = z.string().trim().min(1).max(500)

const entityBaseShape = {
  id: entityIdSchema,
  createdAtUtc: utcInstantSchema,
  updatedAtUtc: utcInstantSchema,
  deletedAtUtc: utcInstantSchema.nullable()
}

export const taskSchema = z.object({
  ...entityBaseShape,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  planDate: dateOnlySchema.nullable(),
  dueDate: dateOnlySchema.nullable(),
  completedAtUtc: utcInstantSchema.nullable()
}).strict()

const scheduleBaseShape = {
  ...entityBaseShape,
  title: titleSchema,
  bodyMarkdown: markdownSchema
}

export const timedScheduleSchema = z.object({
  ...scheduleBaseShape,
  kind: z.literal('timed'),
  startAtUtc: utcInstantSchema,
  endAtUtc: utcInstantSchema
}).strict().refine(
  (value) => value.startAtUtc < value.endAtUtc,
  { message: 'Timed schedule end must be later than start', path: ['endAtUtc'] }
)

export const allDayScheduleSchema = z.object({
  ...scheduleBaseShape,
  kind: z.literal('all-day'),
  startDate: dateOnlySchema,
  endDateExclusive: dateOnlySchema
}).strict().refine(
  (value) => value.startDate < value.endDateExclusive,
  { message: 'All-day schedule end date is exclusive and must be later than start date', path: ['endDateExclusive'] }
)

export const scheduleSchema = z.discriminatedUnion('kind', [timedScheduleSchema, allDayScheduleSchema])

export const noteSchema = z.object({
  ...entityBaseShape,
  title: z.string().max(500),
  bodyMarkdown: markdownSchema
}).strict()

export const captureKindSchema = z.enum(['note', 'task', 'schedule'])

export const draftSchema = z.object({
  id: entityIdSchema,
  captureKind: captureKindSchema,
  payload: z.record(z.string(), z.unknown()),
  revision: z.number().int().nonnegative(),
  createdAtUtc: utcInstantSchema,
  updatedAtUtc: utcInstantSchema,
  savedAtUtc: utcInstantSchema
}).strict()

export const dailyLogSectionSchema = z.enum([
  'completed',
  'pending-at-boundary',
  'planned',
  'notes'
])

export const dailyLogItemSchema = z.object({
  id: entityIdSchema,
  section: dailyLogSectionSchema,
  sourceEntityType: z.enum(['task', 'note', 'schedule']),
  sourceEntityId: entityIdSchema,
  sourceOperationId: entityIdSchema.nullable(),
  stableOrder: z.number().int().nonnegative(),
  snapshotMarkdown: markdownSchema
}).strict()

export const dailyLogSchema = z.object({
  id: entityIdSchema,
  logDate: dateOnlySchema,
  attributionTimeZone: ianaTimeZoneSchema,
  generatedAtUtc: utcInstantSchema,
  generationVersion: z.number().int().positive(),
  autoItems: z.array(dailyLogItemSchema),
  manualMarkdown: markdownSchema,
  createdAtUtc: utcInstantSchema,
  updatedAtUtc: utcInstantSchema
}).strict()

export type DateOnly = z.infer<typeof dateOnlySchema>
export type UtcInstant = z.infer<typeof utcInstantSchema>
export type Task = z.infer<typeof taskSchema>
export type Note = z.infer<typeof noteSchema>
export type TimedSchedule = z.infer<typeof timedScheduleSchema>
export type AllDaySchedule = z.infer<typeof allDayScheduleSchema>
export type Schedule = z.infer<typeof scheduleSchema>
export type CaptureKind = z.infer<typeof captureKindSchema>
export type Draft = z.infer<typeof draftSchema>
export type DailyLogItem = z.infer<typeof dailyLogItemSchema>
export type DailyLog = z.infer<typeof dailyLogSchema>
