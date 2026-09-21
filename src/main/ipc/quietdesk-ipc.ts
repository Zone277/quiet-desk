import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Clock } from '../../shared/clock'
import { dateInTimeZone } from '../../shared/clock'
import { IPC_CONTRACT_VERSION, QUIETDESK_CHANNELS } from '../../shared/ipc-channels'
import {
  bootstrapRequestSchema,
  createNoteRequestSchema,
  getNoteRequestSchema,
  type BootstrapSnapshot,
  type IpcFailure,
  type IpcResult
} from '../../shared/ipc-contract'
import type { NoteStorageService } from '../services/note-storage-service'
import { senderWindowKind, type QuietDeskWindows } from './window-registry'

const IMPLEMENTED_CAPABILITIES = [
  'app.bootstrap',
  'notes.create',
  'notes.get',
  'changes.subscribe'
] as const

const DEFERRED_CAPABILITIES = [
  'tasks CRUD and completion',
  'schedule overlap queries',
  'draft autosave and submit',
  'Daily Log generation',
  'trash, restore and permanent delete',
  'Markdown preview and export'
] as const

interface QuietDeskIpcOptions {
  service: NoteStorageService
  windows: Promise<QuietDeskWindows>
  clock: Clock
  appTimeZone: string
  locale: 'zh-CN' | 'en-US'
  resolvedTheme: 'light' | 'dark'
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

async function authorize(
  event: IpcMainInvokeEvent,
  windowsPromise: Promise<QuietDeskWindows>
): Promise<ReturnType<typeof senderWindowKind>> {
  return senderWindowKind(event.sender, await windowsPromise)
}

export function registerQuietDeskIpc(options: QuietDeskIpcOptions): () => void {
  for (const channel of [
    QUIETDESK_CHANNELS.bootstrap,
    QUIETDESK_CHANNELS.createNote,
    QUIETDESK_CHANNELS.getNote
  ]) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(QUIETDESK_CHANNELS.bootstrap, async (event, raw: unknown): Promise<IpcResult<BootstrapSnapshot>> => {
    const requestId = requestIdFrom(raw)
    const senderKind = await authorize(event, options.windows)
    if (!senderKind) return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')

    const parsed = bootstrapRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return failure(requestId, 'INVALID_REQUEST', 'Invalid bootstrap request', false, {
        issues: parsed.error.issues.map(({ code, path, message }) => ({ code, path, message }))
      })
    }
    if (parsed.data.payload.windowKind !== senderKind) {
      return failure(requestId, 'FORBIDDEN', 'Window identity does not match the sender')
    }

    try {
      return {
        ok: true,
        requestId: parsed.data.requestId,
        value: {
        contractVersion: IPC_CONTRACT_VERSION,
          windowKind: senderKind,
          locale: options.locale,
        theme: 'system',
        resolvedTheme: options.resolvedTheme,
          appTimeZone: options.appTimeZone,
          currentDate: dateInTimeZone(options.clock, options.appTimeZone),
          dataRevision: options.service.getDataRevision(),
        stage: 3,
          implementedCapabilities: [...IMPLEMENTED_CAPABILITIES],
          deferredCapabilities: [...DEFERRED_CAPABILITIES]
        }
      }
    } catch (error) {
      console.error('QUIETDESK_BOOTSTRAP_ERROR', error)
      return failure(requestId, 'STORAGE_ERROR', 'Unable to read application state', true)
    }
  })

  ipcMain.handle(QUIETDESK_CHANNELS.createNote, async (event, raw: unknown) => {
    const requestId = requestIdFrom(raw)
    if (!await authorize(event, options.windows)) {
      return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')
    }
    const parsed = createNoteRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return failure(requestId, 'INVALID_REQUEST', 'Invalid note create request', false, {
        issues: parsed.error.issues.map(({ code, path, message }) => ({ code, path, message }))
      })
    }

    try {
      const result = options.service.createNote(parsed.data)
      if (!result.replayed) {
        const windows = await options.windows
        for (const window of Object.values(windows)) {
          if (!window.isDestroyed()) window.webContents.send(QUIETDESK_CHANNELS.changed, result.change)
        }
      }
      return { ok: true, requestId: parsed.data.requestId, value: result.note }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'CONFLICT') {
        return failure(requestId, 'CONFLICT', 'Idempotency key is bound to a different command')
      }
      console.error('QUIETDESK_NOTE_CREATE_ERROR', error)
      return failure(requestId, 'STORAGE_ERROR', 'Unable to persist the note', true)
    }
  })

  ipcMain.handle(QUIETDESK_CHANNELS.getNote, async (event, raw: unknown) => {
    const requestId = requestIdFrom(raw)
    if (!await authorize(event, options.windows)) {
      return failure(requestId, 'FORBIDDEN', 'Unregistered renderer')
    }
    const parsed = getNoteRequestSchema.safeParse(raw)
    if (!parsed.success) {
      return failure(requestId, 'INVALID_REQUEST', 'Invalid note query', false, {
        issues: parsed.error.issues.map(({ code, path, message }) => ({ code, path, message }))
      })
    }

    try {
      const note = options.service.getNote(parsed.data.payload.id)
      return note
        ? { ok: true, requestId: parsed.data.requestId, value: note }
        : failure(requestId, 'NOT_FOUND', 'Note does not exist')
    } catch (error) {
      console.error('QUIETDESK_NOTE_READ_ERROR', error)
      return failure(requestId, 'STORAGE_ERROR', 'Unable to read the note', true)
    }
  })

  return () => {
    ipcMain.removeHandler(QUIETDESK_CHANNELS.bootstrap)
    ipcMain.removeHandler(QUIETDESK_CHANNELS.createNote)
    ipcMain.removeHandler(QUIETDESK_CHANNELS.getNote)
  }
}
