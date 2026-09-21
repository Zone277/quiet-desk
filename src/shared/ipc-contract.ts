import { z } from 'zod'
import {
  captureDraftPayloadSchema,
  captureKindSchema,
  dateOnlySchema,
  draftSchema,
  entityIdSchema,
  entityRecordSchema,
  entityTypeSchema,
  ianaTimeZoneSchema,
  markdownSchema,
  noteSchema,
  operationSnapshotSchema,
  scheduleSchema,
  taskSchema,
  titleSchema,
  trashEntrySchema,
  utcInstantSchema,
  type Draft,
  type EntityRecord,
  type Note,
  type OperationSnapshot,
  type PermanentDeleteReceipt,
  type Schedule,
  type Task,
  type TrashEntry
} from './model'
export { IPC_CONTRACT_VERSION, QUIETDESK_CHANNELS } from './ipc-channels'
import { IPC_CONTRACT_VERSION } from './ipc-channels'

export const windowKindSchema = z.enum(['widget', 'capture', 'library'])
export const localeSchema = z.enum(['zh-CN', 'en-US'])
export const themeSchema = z.enum(['system', 'light', 'dark'])
export const resolvedThemeSchema = z.enum(['light', 'dark'])
export const requestIdSchema = z.string().uuid()
export const idempotencyKeySchema = z.string().uuid()
const expectedRevisionSchema = z.number().int().positive()
export const entityReferenceSchema = z.object({
  type: entityTypeSchema,
  id: entityIdSchema
}).strict()

function requestEnvelope<T extends z.ZodType>(payload: T) {
  return z.object({ requestId: requestIdSchema, payload }).strict()
}

function mutationEnvelope<T extends z.ZodType>(payload: T) {
  return z.object({
    requestId: requestIdSchema,
    idempotencyKey: idempotencyKeySchema,
    payload
  }).strict()
}

export const bootstrapRequestSchema = requestEnvelope(
  z.object({ windowKind: windowKindSchema }).strict()
)

export const bootstrapSnapshotSchema = z.object({
  contractVersion: z.literal(IPC_CONTRACT_VERSION),
  windowKind: windowKindSchema,
  locale: localeSchema,
  theme: themeSchema,
  resolvedTheme: resolvedThemeSchema,
  appTimeZone: ianaTimeZoneSchema,
  currentDate: dateOnlySchema,
  dataRevision: z.number().int().nonnegative(),
  stage: z.literal(3),
  implementedCapabilities: z.array(z.string()),
  deferredCapabilities: z.array(z.string())
}).strict()

export const taskListItemSchema = z.object({
  task: taskSchema,
  isOverdue: z.boolean()
}).strict()

export const dayScheduleItemSchema = z.object({
  schedule: scheduleSchema,
  queryDate: dateOnlySchema,
  continuesBefore: z.boolean(),
  continuesAfter: z.boolean()
}).strict()

export const noteListItemSchema = z.object({
  note: noteSchema,
  plainTextPreview: z.string().max(280)
}).strict()

export const widgetSnapshotSchema = z.object({
  dataRevision: z.number().int().nonnegative(),
  forDate: dateOnlySchema,
  appTimeZone: ianaTimeZoneSchema,
  currentTasks: z.array(taskListItemSchema),
  todaySchedules: z.array(dayScheduleItemSchema),
  recentNotes: z.array(noteListItemSchema),
  completedToday: z.array(taskSchema),
  totals: z.object({
    currentTasks: z.number().int().nonnegative(),
    todaySchedules: z.number().int().nonnegative(),
    recentNotes: z.number().int().nonnegative(),
    completedToday: z.number().int().nonnegative()
  }).strict()
}).strict()

export const dayTaskItemSchema = z.object({
  task: taskSchema,
  matchReasons: z.array(z.enum(['planned', 'due', 'completed'])).min(1)
}).strict()

export const dayViewSnapshotSchema = z.object({
  dataRevision: z.number().int().nonnegative(),
  selectedDate: dateOnlySchema,
  appTimeZone: ianaTimeZoneSchema,
  tasks: z.array(dayTaskItemSchema),
  schedules: z.array(dayScheduleItemSchema),
  notes: z.array(noteListItemSchema)
}).strict()

export const getWidgetSnapshotRequestSchema = requestEnvelope(z.object({}).strict())
export const getDayViewRequestSchema = requestEnvelope(z.object({ date: dateOnlySchema }).strict())
export const getEntityRequestSchema = requestEnvelope(entityReferenceSchema)
export const getEntityHistoryRequestSchema = requestEnvelope(entityReferenceSchema)
export const listTrashRequestSchema = requestEnvelope(z.object({}).strict())

export const createTaskRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  planDate: dateOnlySchema.nullable(),
  dueDate: dateOnlySchema.nullable()
}).strict())

export const updateTaskRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  planDate: dateOnlySchema.nullable(),
  dueDate: dateOnlySchema.nullable()
}).strict())

export const setTaskCompletionRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  action: z.enum(['complete', 'reopen'])
}).strict())

export const rescheduleTaskRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  planDate: dateOnlySchema.nullable(),
  dueDate: dateOnlySchema.nullable()
}).strict())

export const createNoteRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  title: z.string().max(500),
  bodyMarkdown: markdownSchema
}).strict())

export const getNoteRequestSchema = requestEnvelope(z.object({ id: entityIdSchema }).strict())

export const updateNoteRequestSchema = mutationEnvelope(z.object({
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  title: z.string().max(500),
  bodyMarkdown: markdownSchema
}).strict())

const timedScheduleCreatePayloadSchema = z.object({
  kind: z.literal('timed'),
  id: entityIdSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  startAtUtc: utcInstantSchema,
  endAtUtc: utcInstantSchema
}).strict().refine((value) => value.startAtUtc < value.endAtUtc, {
  message: 'Timed schedule end must be later than start',
  path: ['endAtUtc']
})

const allDayScheduleCreatePayloadSchema = z.object({
  kind: z.literal('all-day'),
  id: entityIdSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  startDate: dateOnlySchema,
  endDateExclusive: dateOnlySchema
}).strict().refine((value) => value.startDate < value.endDateExclusive, {
  message: 'All-day schedule end date is exclusive and must be later than start date',
  path: ['endDateExclusive']
})

export const createScheduleRequestSchema = mutationEnvelope(
  z.union([timedScheduleCreatePayloadSchema, allDayScheduleCreatePayloadSchema])
)

const timedScheduleUpdatePayloadSchema = z.object({
  kind: z.literal('timed'),
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  startAtUtc: utcInstantSchema,
  endAtUtc: utcInstantSchema
}).strict().refine((value) => value.startAtUtc < value.endAtUtc, {
  message: 'Timed schedule end must be later than start',
  path: ['endAtUtc']
})

const allDayScheduleUpdatePayloadSchema = z.object({
  kind: z.literal('all-day'),
  id: entityIdSchema,
  expectedRevision: expectedRevisionSchema,
  title: titleSchema,
  bodyMarkdown: markdownSchema,
  startDate: dateOnlySchema,
  endDateExclusive: dateOnlySchema
}).strict().refine((value) => value.startDate < value.endDateExclusive, {
  message: 'All-day schedule end date is exclusive and must be later than start date',
  path: ['endDateExclusive']
})

export const updateScheduleRequestSchema = mutationEnvelope(
  z.union([timedScheduleUpdatePayloadSchema, allDayScheduleUpdatePayloadSchema])
)

export const getDraftRequestSchema = requestEnvelope(z.object({ id: entityIdSchema }).strict())

export const saveDraftRequestSchema = mutationEnvelope(
  z.object({
    id: entityIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    captureKind: captureKindSchema,
    payload: captureDraftPayloadSchema
  }).strict().refine((value) => (
    (value.captureKind === 'note' && value.payload.kind === 'note') ||
    (value.captureKind === 'task' && value.payload.kind === 'task') ||
    (value.captureKind === 'schedule' && (
      value.payload.kind === 'timed-schedule' || value.payload.kind === 'all-day-schedule'
    ))
  ), { message: 'Draft capture kind does not match its payload', path: ['payload'] })
)

export const entityMutationRequestSchema = mutationEnvelope(z.object({
  entity: entityReferenceSchema,
  expectedRevision: expectedRevisionSchema
}).strict())

export const permanentlyDeleteEntityRequestSchema = mutationEnvelope(
  z.object({
    entity: entityReferenceSchema,
    expectedRevision: expectedRevisionSchema,
    confirmedEntityId: entityIdSchema
  }).strict().refine(
    (value) => value.confirmedEntityId === value.entity.id,
    { message: 'Permanent delete confirmation must match the entity id', path: ['confirmedEntityId'] }
  )
)

export const updateAppearanceRequestSchema = mutationEnvelope(
  z.object({
    locale: localeSchema.optional(),
    theme: themeSchema.optional()
  }).strict().refine(
    (value) => value.locale !== undefined || value.theme !== undefined,
    { message: 'At least one appearance setting is required' }
  )
)

export const showWindowRequestSchema = requestEnvelope(z.object({
  target: z.enum(['capture', 'library']),
  selectedDate: dateOnlySchema.optional()
}).strict())

export const hideWindowRequestSchema = requestEnvelope(
  z.object({ target: z.enum(['capture', 'library']) }).strict()
)

export const appearanceSettingsSchema = z.object({
  locale: localeSchema,
  theme: themeSchema
}).strict()

export const ipcErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STORAGE_ERROR',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR'
])

export interface IpcSuccess<T> {
  ok: true
  requestId: string
  value: T
}

export interface IpcFailure {
  ok: false
  requestId: string
  error: {
    code: z.infer<typeof ipcErrorCodeSchema>
    message: string
    retryable: boolean
    details?: Record<string, unknown>
  }
}

export type IpcResult<T> = IpcSuccess<T> | IpcFailure

export const changeEventSchema = z.object({
  eventId: entityIdSchema,
  sequence: z.number().int().positive(),
  occurredAtUtc: utcInstantSchema,
  topics: z.array(z.enum(['tasks', 'notes', 'schedules', 'drafts', 'daily-logs', 'settings'])).min(1),
  entityRefs: z.array(z.object({
    type: z.enum(['task', 'note', 'schedule', 'draft', 'daily-log']),
    id: entityIdSchema
  }).strict())
}).strict()

export type WindowKind = z.infer<typeof windowKindSchema>
export type Locale = z.infer<typeof localeSchema>
export type Theme = z.infer<typeof themeSchema>
export type ResolvedTheme = z.infer<typeof resolvedThemeSchema>
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>
export type SetTaskCompletionRequest = z.infer<typeof setTaskCompletionRequestSchema>
export type RescheduleTaskRequest = z.infer<typeof rescheduleTaskRequestSchema>
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>
export type GetNoteRequest = z.infer<typeof getNoteRequestSchema>
export type UpdateNoteRequest = z.infer<typeof updateNoteRequestSchema>
export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>
export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>
export type GetDraftRequest = z.infer<typeof getDraftRequestSchema>
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>
export type EntityMutationRequest = z.infer<typeof entityMutationRequestSchema>
export type PermanentlyDeleteEntityRequest = z.infer<typeof permanentlyDeleteEntityRequestSchema>
export type UpdateAppearanceRequest = z.infer<typeof updateAppearanceRequestSchema>
export type ShowWindowRequest = z.infer<typeof showWindowRequestSchema>
export type HideWindowRequest = z.infer<typeof hideWindowRequestSchema>
export type GetWidgetSnapshotRequest = z.infer<typeof getWidgetSnapshotRequestSchema>
export type GetDayViewRequest = z.infer<typeof getDayViewRequestSchema>
export type GetEntityRequest = z.infer<typeof getEntityRequestSchema>
export type GetEntityHistoryRequest = z.infer<typeof getEntityHistoryRequestSchema>
export type ListTrashRequest = z.infer<typeof listTrashRequestSchema>
export type BootstrapSnapshot = z.infer<typeof bootstrapSnapshotSchema>
export type WidgetSnapshot = z.infer<typeof widgetSnapshotSchema>
export type DayViewSnapshot = z.infer<typeof dayViewSnapshotSchema>
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>
export type ChangeEvent = z.infer<typeof changeEventSchema>

export interface QuietDeskApi {
  app: {
    bootstrap(request: BootstrapRequest): Promise<IpcResult<BootstrapSnapshot>>
  }
  widget: {
    getSnapshot(request: GetWidgetSnapshotRequest): Promise<IpcResult<WidgetSnapshot>>
  }
  library: {
    getDay(request: GetDayViewRequest): Promise<IpcResult<DayViewSnapshot>>
    getEntity(request: GetEntityRequest): Promise<IpcResult<EntityRecord>>
    getHistory(request: GetEntityHistoryRequest): Promise<IpcResult<OperationSnapshot[]>>
    listTrash(request: ListTrashRequest): Promise<IpcResult<TrashEntry[]>>
  }
  tasks: {
    create(request: CreateTaskRequest): Promise<IpcResult<Task>>
    update(request: UpdateTaskRequest): Promise<IpcResult<Task>>
    setCompletion(request: SetTaskCompletionRequest): Promise<IpcResult<Task>>
    reschedule(request: RescheduleTaskRequest): Promise<IpcResult<Task>>
  }
  notes: {
    create(request: CreateNoteRequest): Promise<IpcResult<Note>>
    get(request: GetNoteRequest): Promise<IpcResult<Note>>
    update(request: UpdateNoteRequest): Promise<IpcResult<Note>>
  }
  schedules: {
    create(request: CreateScheduleRequest): Promise<IpcResult<Schedule>>
    update(request: UpdateScheduleRequest): Promise<IpcResult<Schedule>>
  }
  drafts: {
    get(request: GetDraftRequest): Promise<IpcResult<Draft | null>>
    save(request: SaveDraftRequest): Promise<IpcResult<Draft>>
  }
  entities: {
    trash(request: EntityMutationRequest): Promise<IpcResult<EntityRecord>>
    restore(request: EntityMutationRequest): Promise<IpcResult<EntityRecord>>
    permanentlyDelete(request: PermanentlyDeleteEntityRequest): Promise<IpcResult<PermanentDeleteReceipt>>
  }
  settings: {
    updateAppearance(request: UpdateAppearanceRequest): Promise<IpcResult<AppearanceSettings>>
  }
  windows: {
    show(request: ShowWindowRequest): Promise<IpcResult<{ shown: true }>>
    hide(request: HideWindowRequest): Promise<IpcResult<{ hidden: true }>>
  }
  changes: {
    subscribe(listener: (event: ChangeEvent) => void): () => void
  }
}
