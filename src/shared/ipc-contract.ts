import { z } from 'zod'
import {
  dateOnlySchema,
  entityIdSchema,
  ianaTimeZoneSchema,
  noteSchema,
  titleSchema,
  utcInstantSchema,
  markdownSchema,
  type Note
} from './model'
export { IPC_CONTRACT_VERSION, QUIETDESK_CHANNELS } from './ipc-channels'
import { IPC_CONTRACT_VERSION } from './ipc-channels'

export const windowKindSchema = z.enum(['widget', 'capture', 'library'])
export const requestIdSchema = z.string().uuid()
export const idempotencyKeySchema = z.string().uuid()

export const bootstrapRequestSchema = z.object({
  requestId: requestIdSchema,
  payload: z.object({ windowKind: windowKindSchema }).strict()
}).strict()

export const createNoteRequestSchema = z.object({
  requestId: requestIdSchema,
  idempotencyKey: idempotencyKeySchema,
  payload: z.object({
    id: entityIdSchema,
    title: z.string().max(500),
    bodyMarkdown: markdownSchema
  }).strict()
}).strict()

export const getNoteRequestSchema = z.object({
  requestId: requestIdSchema,
  payload: z.object({ id: entityIdSchema }).strict()
}).strict()

export const bootstrapSnapshotSchema = z.object({
  contractVersion: z.literal(IPC_CONTRACT_VERSION),
  windowKind: windowKindSchema,
  locale: z.enum(['zh-CN', 'en-US']),
  theme: z.enum(['system', 'light', 'dark']),
  appTimeZone: ianaTimeZoneSchema,
  currentDate: dateOnlySchema,
  dataRevision: z.number().int().nonnegative(),
  stage: z.literal(2),
  implementedCapabilities: z.array(z.enum(['app.bootstrap', 'notes.create', 'notes.get', 'changes.subscribe'])),
  deferredCapabilities: z.array(z.string())
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

export const entityReferenceSchema = z.object({
  type: z.enum(['task', 'note', 'schedule', 'draft', 'daily-log']),
  id: entityIdSchema
}).strict()

export const changeEventSchema = z.object({
  eventId: entityIdSchema,
  sequence: z.number().int().positive(),
  occurredAtUtc: utcInstantSchema,
  topics: z.array(z.enum(['tasks', 'notes', 'schedules', 'drafts', 'daily-logs', 'settings'])).min(1),
  entityRefs: z.array(entityReferenceSchema)
}).strict()

export type WindowKind = z.infer<typeof windowKindSchema>
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>
export type CreateNoteRequest = z.infer<typeof createNoteRequestSchema>
export type GetNoteRequest = z.infer<typeof getNoteRequestSchema>
export type BootstrapSnapshot = z.infer<typeof bootstrapSnapshotSchema>
export type ChangeEvent = z.infer<typeof changeEventSchema>

export interface QuietDeskApi {
  app: {
    bootstrap(request: BootstrapRequest): Promise<IpcResult<BootstrapSnapshot>>
  }
  notes: {
    create(request: CreateNoteRequest): Promise<IpcResult<Note>>
    get(request: GetNoteRequest): Promise<IpcResult<Note>>
  }
  changes: {
    subscribe(listener: (event: ChangeEvent) => void): () => void
  }
}
