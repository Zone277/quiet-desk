import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import { EntityNotFoundError, IdempotencyConflictError, StorageConflictError } from '../../domain/storage-errors'
import type { Clock } from '../../shared/clock'
import { dateInTimeZone } from '../../shared/clock'
import { IPC_CONTRACT_VERSION, QUIETDESK_CHANNELS } from '../../shared/ipc-channels'
import {
  bootstrapRequestSchema,
  createNoteRequestSchema,
  createScheduleRequestSchema,
  createTaskRequestSchema,
  entityMutationRequestSchema,
  getDayViewRequestSchema,
  getDraftRequestSchema,
  getEntityHistoryRequestSchema,
  getEntityRequestSchema,
  getNoteRequestSchema,
  getWidgetSnapshotRequestSchema,
  hideWindowRequestSchema,
  listTrashRequestSchema,
  permanentlyDeleteEntityRequestSchema,
  rescheduleTaskRequestSchema,
  saveDraftRequestSchema,
  setTaskCompletionRequestSchema,
  showWindowRequestSchema,
  updateAppearanceRequestSchema,
  updateNoteRequestSchema,
  updateScheduleRequestSchema,
  updateTaskRequestSchema,
  type AppearanceSettings,
  type BootstrapSnapshot,
  type ChangeEvent,
  type IpcFailure,
  type IpcResult,
  type Theme
} from '../../shared/ipc-contract'
import type { CoreDataService, MutationResult } from '../services/core-data-service'
import { senderWindowKind, type QuietDeskWindows } from './window-registry'

const IMPLEMENTED_CAPABILITIES = [
  'app.bootstrap',
  'widget.getSnapshot',
  'library.getDay',
  'library.getEntity',
  'library.getHistory',
  'library.listTrash',
  'tasks.create',
  'tasks.update',
  'tasks.setCompletion',
  'tasks.reschedule',
  'notes.create',
  'notes.get',
  'notes.update',
  'schedules.create',
  'schedules.update',
  'drafts.get',
  'drafts.save',
  'entities.trash',
  'entities.restore',
  'entities.permanentlyDelete',
  'settings.updateAppearance',
  'windows.show',
  'windows.hide',
  'windows.subscribeContext',
  'changes.subscribe'
] as const

const DEFERRED_CAPABILITIES = [
  'Daily Log generation',
  'Markdown preview and export',
  'capture keyboard and IME acceptance'
] as const

const HANDLER_CHANNELS = [
  QUIETDESK_CHANNELS.bootstrap,
  QUIETDESK_CHANNELS.widgetSnapshot,
  QUIETDESK_CHANNELS.daySnapshot,
  QUIETDESK_CHANNELS.getEntity,
  QUIETDESK_CHANNELS.getHistory,
  QUIETDESK_CHANNELS.listTrash,
  QUIETDESK_CHANNELS.createTask,
  QUIETDESK_CHANNELS.updateTask,
  QUIETDESK_CHANNELS.setTaskCompletion,
  QUIETDESK_CHANNELS.rescheduleTask,
  QUIETDESK_CHANNELS.createNote,
  QUIETDESK_CHANNELS.getNote,
  QUIETDESK_CHANNELS.updateNote,
  QUIETDESK_CHANNELS.createSchedule,
  QUIETDESK_CHANNELS.updateSchedule,
  QUIETDESK_CHANNELS.getDraft,
  QUIETDESK_CHANNELS.saveDraft,
  QUIETDESK_CHANNELS.trashEntity,
  QUIETDESK_CHANNELS.restoreEntity,
  QUIETDESK_CHANNELS.permanentlyDeleteEntity,
  QUIETDESK_CHANNELS.updateAppearance,
  QUIETDESK_CHANNELS.showWindow,
  QUIETDESK_CHANNELS.hideWindow
] as const

interface QuietDeskIpcOptions {
  service: CoreDataService
  windows: Promise<QuietDeskWindows>
  clock: Clock
  appTimeZone: string
  defaultLocale: 'zh-CN' | 'en-US'
  applyTheme(theme: Theme): void
  resolvedTheme(): 'light' | 'dark'
}

function requestIdFrom(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'invalid'
  const requestId = (value as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.length <= 128 ? requestId : 'invalid'
}

function failure(
  requestId: string,
  code: IpcFailure['error']['code'],
  message: string,
  retryable = false,
  details?: Record<string, unknown>
): IpcFailure {
  return {
    ok: false,
    requestId,
    error: { code, message, retryable, ...(details ? { details } : {}) }
  }
}

function invalidRequest(requestId: string, label: string, issues: Array<{
  code: string
  path: PropertyKey[]
  message: string
}>): IpcFailure {
  return failure(requestId, 'INVALID_REQUEST', `Invalid ${label} request`, false, {
    issues: issues.map(({ code, path, message }) => ({ code, path, message }))
  })
}

function isRetryableStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /database is locked|database is busy|SQLITE_BUSY/iu.test(error.message)
}

function serviceFailure(requestId: string, label: string, error: unknown): IpcFailure {
  if (error instanceof EntityNotFoundError) {
    return failure(requestId, 'NOT_FOUND', error.message)
  }
  if (error instanceof IdempotencyConflictError || error instanceof StorageConflictError) {
    return failure(requestId, 'CONFLICT', error.message)
  }
  const retryable = isRetryableStorageError(error)
  console.error(`QUIETDESK_${label.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_ERROR`, error)
  return failure(requestId, 'STORAGE_ERROR', `Unable to ${label}`, retryable)
}

async function authorize(
  event: IpcMainInvokeEvent,
  windowsPromise: Promise<QuietDeskWindows>
): Promise<ReturnType<typeof senderWindowKind>> {
  return senderWindowKind(event.sender, await windowsPromise)
}

async function broadcast(windowsPromise: Promise<QuietDeskWindows>, change: ChangeEvent): Promise<void> {
  const windows = await windowsPromise
  for (const window of Object.values(windows)) {
    if (!window.isDestroyed()) window.webContents.send(QUIETDESK_CHANNELS.changed, change)
  }
}

export function registerQuietDeskIpc(options: QuietDeskIpcOptions): () => void {
  for (const channel of HANDLER_CHANNELS) ipcMain.removeHandler(channel)

  const registerRead = <TRequest, TValue>(
    channel: string,
    label: string,
    schema: ZodType<TRequest>,
    read: (request: TRequest) => TValue | undefined,
    notFoundMessage?: string
  ): void => {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<TValue>> => {
      const requestId = requestIdFrom(raw)
      if (!await authorize(event, options.windows)) {
        return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return invalidRequest(requestId, label, parsed.error.issues)
      try {
        const value = read(parsed.data)
        if (value === undefined && notFoundMessage) {
          return failure(requestId, 'NOT_FOUND', notFoundMessage)
        }
        return { ok: true, requestId, value: value as TValue }
      } catch (error) {
        return serviceFailure(requestId, label, error)
      }
    })
  }

  const registerMutation = <TRequest, TValue>(
    channel: string,
    label: string,
    schema: ZodType<TRequest>,
    mutate: (request: TRequest) => MutationResult<TValue>,
    afterCommit?: (value: TValue) => void
  ): void => {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<TValue>> => {
      const requestId = requestIdFrom(raw)
      if (!await authorize(event, options.windows)) {
        return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) return invalidRequest(requestId, label, parsed.error.issues)
      try {
        const result = mutate(parsed.data)
        afterCommit?.(result.value)
        if (!result.replayed) await broadcast(options.windows, result.change)
        return { ok: true, requestId, value: result.value }
      } catch (error) {
        return serviceFailure(requestId, label, error)
      }
    })
  }

  ipcMain.handle(
    QUIETDESK_CHANNELS.bootstrap,
    async (event, raw: unknown): Promise<IpcResult<BootstrapSnapshot>> => {
      const requestId = requestIdFrom(raw)
      const senderKind = await authorize(event, options.windows)
      if (!senderKind) return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')
      const parsed = bootstrapRequestSchema.safeParse(raw)
      if (!parsed.success) return invalidRequest(requestId, 'bootstrap', parsed.error.issues)
      if (parsed.data.payload.windowKind !== senderKind) {
        return failure(requestId, 'FORBIDDEN', 'Window identity does not match the sender')
      }

      try {
        const appearance = options.service.getOrCreateAppearance(options.defaultLocale)
        options.applyTheme(appearance.theme)
        return {
          ok: true,
          requestId,
          value: {
            contractVersion: IPC_CONTRACT_VERSION,
            windowKind: senderKind,
            locale: appearance.locale,
            theme: appearance.theme,
            resolvedTheme: options.resolvedTheme(),
            appTimeZone: options.appTimeZone,
            currentDate: dateInTimeZone(options.clock, options.appTimeZone),
            dataRevision: options.service.getDataRevision(),
            stage: 3,
            implementedCapabilities: [...IMPLEMENTED_CAPABILITIES],
            deferredCapabilities: [...DEFERRED_CAPABILITIES]
          }
        }
      } catch (error) {
        return serviceFailure(requestId, 'bootstrap application state', error)
      }
    }
  )

  registerRead(QUIETDESK_CHANNELS.widgetSnapshot, 'Widget snapshot', getWidgetSnapshotRequestSchema,
    () => options.service.getWidgetSnapshot())
  registerRead(QUIETDESK_CHANNELS.daySnapshot, 'day view', getDayViewRequestSchema,
    (request) => options.service.getDayView(request.payload.date))
  registerRead(QUIETDESK_CHANNELS.getEntity, 'entity query', getEntityRequestSchema,
    (request) => options.service.getEntity(request.payload), 'Entity does not exist')
  registerRead(QUIETDESK_CHANNELS.getHistory, 'entity history', getEntityHistoryRequestSchema,
    (request) => options.service.getHistory(request.payload))
  registerRead(QUIETDESK_CHANNELS.listTrash, 'trash list', listTrashRequestSchema,
    () => options.service.listTrash())

  registerMutation(QUIETDESK_CHANNELS.createTask, 'create task', createTaskRequestSchema,
    (request) => options.service.createTask(request))
  registerMutation(QUIETDESK_CHANNELS.updateTask, 'update task', updateTaskRequestSchema,
    (request) => options.service.updateTask(request))
  registerMutation(QUIETDESK_CHANNELS.setTaskCompletion, 'set task completion', setTaskCompletionRequestSchema,
    (request) => options.service.setTaskCompletion(request))
  registerMutation(QUIETDESK_CHANNELS.rescheduleTask, 'reschedule task', rescheduleTaskRequestSchema,
    (request) => options.service.rescheduleTask(request))

  registerMutation(QUIETDESK_CHANNELS.createNote, 'create note', createNoteRequestSchema,
    (request) => options.service.createNote(request))
  registerRead(QUIETDESK_CHANNELS.getNote, 'note query', getNoteRequestSchema,
    (request) => options.service.getNote(request.payload.id), 'Note does not exist')
  registerMutation(QUIETDESK_CHANNELS.updateNote, 'update note', updateNoteRequestSchema,
    (request) => options.service.updateNote(request))

  registerMutation(QUIETDESK_CHANNELS.createSchedule, 'create schedule', createScheduleRequestSchema,
    (request) => options.service.createSchedule(request))
  registerMutation(QUIETDESK_CHANNELS.updateSchedule, 'update schedule', updateScheduleRequestSchema,
    (request) => options.service.updateSchedule(request))

  registerRead(QUIETDESK_CHANNELS.getDraft, 'draft query', getDraftRequestSchema,
    (request) => options.service.getDraft(request.payload.id) ?? null)
  registerMutation(QUIETDESK_CHANNELS.saveDraft, 'save draft', saveDraftRequestSchema,
    (request) => options.service.saveDraft(request))

  registerMutation(QUIETDESK_CHANNELS.trashEntity, 'move entity to trash', entityMutationRequestSchema,
    (request) => options.service.trashEntity(request))
  registerMutation(QUIETDESK_CHANNELS.restoreEntity, 'restore entity', entityMutationRequestSchema,
    (request) => options.service.restoreEntity(request))
  registerMutation(
    QUIETDESK_CHANNELS.permanentlyDeleteEntity,
    'permanently delete entity',
    permanentlyDeleteEntityRequestSchema,
    (request) => options.service.permanentlyDeleteEntity(request)
  )

  registerMutation<Parameters<CoreDataService['updateAppearance']>[0], AppearanceSettings>(
    QUIETDESK_CHANNELS.updateAppearance,
    'update appearance',
    updateAppearanceRequestSchema,
    (request) => options.service.updateAppearance(request),
    (appearance) => options.applyTheme(appearance.theme)
  )

  ipcMain.handle(QUIETDESK_CHANNELS.showWindow, async (event, raw: unknown) => {
    const requestId = requestIdFrom(raw)
    const senderKind = await authorize(event, options.windows)
    if (senderKind !== 'widget') {
      return failure(requestId, 'FORBIDDEN', 'Only the Widget may show auxiliary windows')
    }
    const parsed = showWindowRequestSchema.safeParse(raw)
    if (!parsed.success) return invalidRequest(requestId, 'show window', parsed.error.issues)
    const windows = await options.windows
    const target = windows[parsed.data.payload.target]
    if (target.isDestroyed()) return failure(requestId, 'INTERNAL_ERROR', 'Target window is unavailable')
    if (parsed.data.payload.target === 'library' && parsed.data.payload.selectedDate) {
      target.webContents.send(QUIETDESK_CHANNELS.windowContext, {
        target: 'library',
        selectedDate: parsed.data.payload.selectedDate
      })
    }
    target.show()
    target.focus()
    return { ok: true, requestId, value: { shown: true as const } }
  })

  ipcMain.handle(QUIETDESK_CHANNELS.hideWindow, async (event, raw: unknown) => {
    const requestId = requestIdFrom(raw)
    const senderKind = await authorize(event, options.windows)
    const parsed = hideWindowRequestSchema.safeParse(raw)
    if (!parsed.success) return invalidRequest(requestId, 'hide window', parsed.error.issues)
    if (senderKind !== parsed.data.payload.target) {
      return failure(requestId, 'FORBIDDEN', 'A window may only hide itself')
    }
    const windows = await options.windows
    const target = windows[parsed.data.payload.target]
    if (target.isDestroyed()) return failure(requestId, 'INTERNAL_ERROR', 'Target window is unavailable')
    target.hide()
    return { ok: true, requestId, value: { hidden: true as const } }
  })

  return () => {
    for (const channel of HANDLER_CHANNELS) ipcMain.removeHandler(channel)
  }
}
