import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { FixedClock } from '../../src/shared/clock'
import type { CreateNoteRequest } from '../../src/shared/ipc-contract'
import {
  IdempotencyConflictError,
  NoteStorageService
} from '../../src/main/services/note-storage-service'

const FIXED_INSTANT = '2026-09-21T03:04:05.678Z'
const temporaryRoots = new Set<string>()
const openServices = new Set<NoteStorageService>()

async function createDatabasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-data-'))
  temporaryRoots.add(root)
  return join(root, 'nested', 'quietdesk-test.sqlite3')
}

function openService(databasePath: string): NoteStorageService {
  const service = new NoteStorageService({
    databasePath,
    clock: new FixedClock(FIXED_INSTANT)
  })
  openServices.add(service)
  return service
}

function closeService(service: NoteStorageService): void {
  service.close()
  openServices.delete(service)
}

function createRequest(overrides: Partial<CreateNoteRequest> = {}): CreateNoteRequest {
  const base: CreateNoteRequest = {
    requestId: randomUUID(),
    idempotencyKey: randomUUID(),
    payload: {
      id: randomUUID(),
      title: '安静记录 / Quiet note',
      bodyMarkdown: '# 安静记录\n\n中英文 mixed text，emoji 🪴'
    }
  }
  return {
    ...base,
    ...overrides,
    payload: overrides.payload ?? base.payload
  }
}

afterEach(async () => {
  for (const service of openServices) service.close()
  openServices.clear()

  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  temporaryRoots.clear()
})

describe('NoteStorageService', () => {
  test('applies the ordered user_version migration and creates the required tables', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)
    closeService(service)

    const database = new DatabaseSync(databasePath)
    try {
      const version = database.prepare('PRAGMA user_version').get() as { user_version?: number }
      const tables = database.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as Array<{ name: string }>

      expect(version.user_version).toBe(1)
      expect(tables.map(({ name }) => name)).toEqual([
        'app_settings',
        'change_events',
        'idempotency_receipts',
        'notes'
      ])
    } finally {
      database.close()
    }
  })

  test('writes and reads a parameterized Unicode Note with one monotonic change', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)
    const request = createRequest()

    const result = service.createNote(request)

    expect(result).toMatchObject({
      replayed: false,
      note: {
        ...request.payload,
        createdAtUtc: FIXED_INSTANT,
        updatedAtUtc: FIXED_INSTANT,
        deletedAtUtc: null
      },
      change: {
        sequence: 1,
        occurredAtUtc: FIXED_INSTANT,
        topics: ['notes'],
        entityRefs: [{ type: 'note', id: request.payload.id }]
      }
    })
    expect(service.getNote(request.payload.id)).toEqual(result.note)
    expect(service.getDataRevision()).toBe(1)
  })

  test('replays the original result for the same idempotency key and command', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)
    const firstRequest = createRequest()
    const first = service.createNote(firstRequest)
    const replay = service.createNote({
      ...firstRequest,
      requestId: randomUUID()
    })

    expect(replay).toEqual({ ...first, replayed: true })
    expect(service.getDataRevision()).toBe(1)
  })

  test('assigns strictly increasing sequences to distinct committed changes', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)

    const first = service.createNote(createRequest())
    const second = service.createNote(createRequest())

    expect(first.change.sequence).toBe(1)
    expect(second.change.sequence).toBe(2)
    expect(service.getDataRevision()).toBe(2)
  })

  test('rejects a reused idempotency key with a different command without a new change', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)
    const firstRequest = createRequest()
    service.createNote(firstRequest)
    const conflictingRequest = createRequest({
      idempotencyKey: firstRequest.idempotencyKey
    })

    let conflict: unknown
    try {
      service.createNote(conflictingRequest)
    } catch (error) {
      conflict = error
    }
    expect(conflict).toBeInstanceOf(IdempotencyConflictError)
    expect(conflict).toMatchObject({
      code: 'CONFLICT',
      idempotencyKey: firstRequest.idempotencyKey
    })
    expect(service.getNote(conflictingRequest.payload.id)).toBeUndefined()
    expect(service.getDataRevision()).toBe(1)
  })

  test('retains the Note and data revision after close and reopen at the same path', async () => {
    const databasePath = await createDatabasePath()
    const firstService = openService(databasePath)
    const request = createRequest()
    const created = firstService.createNote(request)
    closeService(firstService)

    const reopenedService = openService(databasePath)
    expect(reopenedService.getNote(request.payload.id)).toEqual(created.note)
    expect(reopenedService.getDataRevision()).toBe(created.change.sequence)
    expect(reopenedService.createNote({ ...request, requestId: randomUUID() })).toEqual({
      ...created,
      replayed: true
    })
    expect(reopenedService.getDataRevision()).toBe(created.change.sequence)
  })

  test('persists the first valid app time zone and returns it after reopen', async () => {
    const databasePath = await createDatabasePath()
    const firstService = openService(databasePath)
    expect(firstService.getOrCreateAppTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    closeService(firstService)

    const reopenedService = openService(databasePath)
    expect(reopenedService.getOrCreateAppTimeZone('America/New_York')).toBe('Asia/Shanghai')
    expect(reopenedService.getDataRevision()).toBe(0)
  })

  test('rejects a default app time zone that Intl does not recognize', async () => {
    const databasePath = await createDatabasePath()
    const service = openService(databasePath)

    expect(() => service.getOrCreateAppTimeZone('Mars/Olympus_Mons')).toThrow()
    expect(service.getDataRevision()).toBe(0)
  })
})
