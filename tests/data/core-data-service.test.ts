import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { FixedClock } from '../../src/shared/clock'
import type { DateOnly, EntityType } from '../../src/shared/model'
import type {
  CreateNoteRequest,
  CreateScheduleRequest,
  CreateTaskRequest,
  EntityMutationRequest,
  SaveDraftRequest
} from '../../src/shared/ipc-contract'
import {
  CoreDataService,
  EntityNotFoundError,
  IdempotencyConflictError,
  StorageConflictError
} from '../../src/main/services/core-data-service'

const TODAY = '2026-09-21' as DateOnly
const BASE_INSTANT = '2026-09-21T03:04:05.678Z'
const temporaryRoots = new Set<string>()
const services = new Set<CoreDataService>()

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-stage3-data-'))
  temporaryRoots.add(root)
  const nested = join(root, 'nested')
  await mkdir(nested, { recursive: true })
  return join(nested, 'quietdesk.sqlite3')
}

function open(path: string, instant = BASE_INSTANT): CoreDataService {
  const service = new CoreDataService({ databasePath: path, clock: new FixedClock(instant) })
  services.add(service)
  return service
}

function close(service: CoreDataService): void {
  service.close()
  services.delete(service)
}

function envelope<T>(
  payload: T,
  idempotencyKey: CreateTaskRequest['idempotencyKey'] = randomUUID()
) {
  return { requestId: randomUUID(), idempotencyKey, payload }
}

function taskRequest(
  overrides: Partial<CreateTaskRequest['payload']> = {},
  idempotencyKey?: CreateTaskRequest['idempotencyKey']
): CreateTaskRequest {
  return envelope({
    id: randomUUID(),
    title: '整理 QuietDesk 阶段三验收 ✅',
    bodyMarkdown: '检查 planDate / dueDate，保留中英文 mixed text。',
    planDate: TODAY,
    dueDate: null,
    ...overrides
  }, idempotencyKey)
}

function noteRequest(
  overrides: Partial<CreateNoteRequest['payload']> = {},
  idempotencyKey?: CreateTaskRequest['idempotencyKey']
): CreateNoteRequest {
  return envelope({
    id: randomUUID(),
    title: '安静记录',
    bodyMarkdown: '# 中文 / English 🌙',
    ...overrides
  }, idempotencyKey)
}

function timedScheduleRequest(
  overrides: Partial<Extract<CreateScheduleRequest['payload'], { kind: 'timed' }>> = {}
): CreateScheduleRequest {
  return envelope({
    kind: 'timed' as const,
    id: randomUUID(),
    title: '跨午夜会议',
    bodyMarkdown: '计划，不表示已参加',
    startAtUtc: '2026-09-21T15:30:00.000Z',
    endAtUtc: '2026-09-21T16:30:00.000Z',
    ...overrides
  })
}

function entityMutation(
  type: EntityType,
  id: string,
  expectedRevision: number,
  idempotencyKey: CreateTaskRequest['idempotencyKey'] = randomUUID()
): EntityMutationRequest {
  return envelope({ entity: { type, id }, expectedRevision }, idempotencyKey)
}

afterEach(async () => {
  for (const service of services) service.close()
  services.clear()
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  temporaryRoots.clear()
})

describe('CoreDataService stage 3', () => {
  test('S3-D01/D11 creates and edits Unicode entities with parameterized SQL', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const hostile = `中英'; DROP TABLE tasks; -- 🌙`

    const createdTask = service.createTask(taskRequest({ title: hostile }))
    const updatedTask = service.updateTask(envelope({
      id: createdTask.value.id,
      expectedRevision: 1,
      title: `${hostile} edited`,
      bodyMarkdown: `正文 "quoted"; DELETE FROM notes; --`,
      planDate: '2026-09-20',
      dueDate: '2026-09-23'
    }))
    expect(updatedTask.value).toMatchObject({
      revision: 2,
      planDate: '2026-09-20',
      dueDate: '2026-09-23',
      completedAtUtc: null,
      createdAtUtc: createdTask.value.createdAtUtc
    })

    const createdNote = service.createNote(noteRequest({ bodyMarkdown: hostile }))
    const updatedNote = service.updateNote(envelope({
      id: createdNote.value.id,
      expectedRevision: 1,
      title: hostile,
      bodyMarkdown: `${hostile}\nupdated`
    }))
    expect(service.getNote(createdNote.value.id)).toEqual(updatedNote.value)

    const createdSchedule = service.createSchedule(timedScheduleRequest({ bodyMarkdown: hostile }))
    const updatedSchedule = service.updateSchedule(envelope({
      kind: 'all-day' as const,
      id: createdSchedule.value.id,
      expectedRevision: 1,
      title: hostile,
      bodyMarkdown: hostile,
      startDate: '2026-09-21',
      endDateExclusive: '2026-09-23'
    }))
    expect(updatedSchedule.value).toMatchObject({ kind: 'all-day', revision: 2 })
    expect(service.getEntity({ type: 'task', id: createdTask.value.id })?.value.title)
      .toBe(`${hostile} edited`)
  })

  test('S3-D02/D12 keeps yesterday current, separates future tasks, and sorts stably', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const yesterday = service.createTask(taskRequest({
      title: 'yesterday', planDate: '2026-09-20', dueDate: '2026-09-22'
    })).value
    const noPlan = service.createTask(taskRequest({
      title: 'no plan', planDate: null, dueDate: null
    })).value
    const futureFirst = service.createTask(taskRequest({
      title: 'future first', planDate: '2026-09-22', dueDate: null
    })).value
    const futureSecond = service.createTask(taskRequest({
      title: 'future second', planDate: '2026-09-22', dueDate: null
    })).value

    expect(service.listCurrentTasks(TODAY).map(({ id }) => id)).toEqual([
      yesterday.id,
      noPlan.id
    ])
    expect(service.listFutureTasks(TODAY).map(({ id }) => id)).toEqual([
      futureFirst.id,
      futureSecond.id
    ])
    expect(service.getEntity({ type: 'task', id: yesterday.id })?.value)
      .toMatchObject({ planDate: '2026-09-20', dueDate: '2026-09-22' })
    expect(service.getHistory({ type: 'task', id: yesterday.id })).toHaveLength(1)
  })

  test('S3-D03 completes across reopen and preserves ordered completion/reopen history', async () => {
    const path = await databasePath()
    let service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const task = service.createTask(taskRequest({ planDate: '2026-09-20' })).value
    const completed = service.setTaskCompletion(envelope({
      id: task.id, expectedRevision: 1, action: 'complete' as const
    })).value
    expect(service.listCurrentTasks(TODAY)).toEqual([])
    close(service)

    service = open(path, '2026-09-21T04:00:00.000Z')
    expect(service.getEntity({ type: 'task', id: task.id })?.value).toEqual(completed)
    const reopened = service.setTaskCompletion(envelope({
      id: task.id, expectedRevision: 2, action: 'reopen' as const
    })).value
    expect(reopened).toMatchObject({ revision: 3, completedAtUtc: null, planDate: '2026-09-20' })
    expect(service.listCurrentTasks(TODAY).map(({ id }) => id)).toEqual([task.id])
    expect(service.getWidgetSnapshot().completedToday).toEqual([])
    expect(service.getHistory({ type: 'task', id: task.id }).map(({ operation }) => operation))
      .toEqual(['task.created', 'task.completed', 'task.reopened'])
  })

  test('S3-D04 reschedules without changing completion and moves a task to future', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const task = service.createTask(taskRequest({ planDate: TODAY, dueDate: '2026-09-22' })).value
    const moved = service.rescheduleTask(envelope({
      id: task.id,
      expectedRevision: 1,
      planDate: '2026-09-24',
      dueDate: null
    })).value
    expect(moved).toMatchObject({
      revision: 2,
      planDate: '2026-09-24',
      dueDate: null,
      completedAtUtc: null
    })
    expect(service.listCurrentTasks(TODAY)).toEqual([])
    expect(service.listFutureTasks(TODAY).map(({ id }) => id)).toEqual([task.id])
    const history = service.getHistory({ type: 'task', id: task.id })
    expect(history.at(-2)?.snapshot.value).toMatchObject({ planDate: TODAY, dueDate: '2026-09-22' })
    expect(history.at(-1)?.snapshot.value).toMatchObject({ planDate: '2026-09-24', dueDate: null })
  })

  test('S3-D05/D06 queries timed, DST, and all-day half-open overlaps', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const timed = service.createSchedule(timedScheduleRequest()).value
    const boundary = service.createSchedule(timedScheduleRequest({
      id: randomUUID(),
      title: 'ends at day start',
      startAtUtc: '2026-09-20T15:00:00.000Z',
      endAtUtc: '2026-09-20T16:00:00.000Z'
    })).value
    const allDay = service.createSchedule(envelope({
      kind: 'all-day' as const,
      id: randomUUID(),
      title: '多日全天',
      bodyMarkdown: '',
      startDate: '2026-09-21',
      endDateExclusive: '2026-09-23'
    })).value

    expect(service.getDayView('2026-09-20').schedules.map(({ schedule }) => schedule.id))
      .toEqual([boundary.id])
    expect(service.getDayView('2026-09-21').schedules.map(({ schedule }) => schedule.id))
      .toEqual([allDay.id, timed.id])
    expect(service.getDayView('2026-09-22').schedules.map(({ schedule }) => schedule.id))
      .toEqual([allDay.id, timed.id])
    expect(service.getDayView('2026-09-23').schedules).toEqual([])

    const dstPath = await databasePath()
    const dstService = open(dstPath, '2026-03-08T12:00:00.000Z')
    dstService.getOrCreateAppTimeZone('America/New_York')
    const dst = dstService.createSchedule(timedScheduleRequest({
      id: randomUUID(),
      startAtUtc: '2026-03-09T03:30:00.000Z',
      endAtUtc: '2026-03-09T04:30:00.000Z'
    })).value
    expect(dstService.getDayView('2026-03-08').schedules.map(({ schedule }) => schedule.id))
      .toEqual([dst.id])
    expect(dstService.getDayView('2026-03-09').schedules.map(({ schedule }) => schedule.id))
      .toEqual([dst.id])
  })

  test('S3-D07 hides trashed entities and restores original content and dates', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const task = service.createTask(taskRequest()).value
    const note = service.createNote(noteRequest()).value
    const schedule = service.createSchedule(timedScheduleRequest()).value

    const trashedTask = service.trashEntity(entityMutation('task', task.id, 1)).value
    service.trashEntity(entityMutation('note', note.id, 1))
    service.trashEntity(entityMutation('schedule', schedule.id, 1))
    expect(service.getWidgetSnapshot().totals).toEqual({
      currentTasks: 0, todaySchedules: 0, recentNotes: 0, completedToday: 0
    })
    expect(service.listTrash()).toHaveLength(3)

    const restored = service.restoreEntity(entityMutation('task', task.id, trashedTask.value.revision)).value
    expect(restored.value).toMatchObject({
      title: task.title,
      planDate: task.planDate,
      dueDate: task.dueDate,
      deletedAtUtc: null,
      revision: 3
    })
    expect(service.getWidgetSnapshot().totals.currentTasks).toBe(1)
  })

  test('S3-D08 requires confirmation and purges managed body and snapshots', async () => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const create = noteRequest({ title: 'secret-title', bodyMarkdown: 'secret-body' })
    const note = service.createNote(create).value
    const trashed = service.trashEntity(entityMutation('note', note.id, 1)).value

    expect(() => service.permanentlyDeleteEntity(envelope({
      entity: { type: 'note' as const, id: note.id },
      expectedRevision: trashed.value.revision,
      confirmedEntityId: randomUUID()
    }))).toThrow()

    const deleted = service.permanentlyDeleteEntity(envelope({
      entity: { type: 'note' as const, id: note.id },
      expectedRevision: trashed.value.revision,
      confirmedEntityId: note.id
    }))
    expect(deleted.value).toMatchObject({ entityType: 'note', entityId: note.id })
    expect(service.getEntity({ type: 'note', id: note.id })).toBeUndefined()
    expect(service.getHistory({ type: 'note', id: note.id })).toEqual([])
    expect(() => service.createNote({ ...create, requestId: randomUUID() }))
      .toThrow(EntityNotFoundError)
    close(service)

    const database = new DatabaseSync(path)
    try {
      const noteCount = database.prepare('SELECT count(*) AS count FROM notes WHERE id = ?')
        .get(note.id) as { count: number }
      const historyCount = database.prepare(`
        SELECT count(*) AS count FROM operation_history
        WHERE entity_type = ? AND entity_id = ?
      `).get('note', note.id) as { count: number }
      const receipts = database.prepare(`
        SELECT result_json FROM idempotency_receipts
        WHERE subject_type = ? AND subject_id = ?
      `).all('note', note.id) as Array<{ result_json: string | null }>
      expect(noteCount.count).toBe(0)
      expect(historyCount.count).toBe(0)
      expect(receipts.map(({ result_json }) => result_json).join(' ')).not.toContain('secret-')
    } finally {
      database.close()
    }
  })

  test('S3-D09 persists draft revisions and never adds operation history', async () => {
    const path = await databasePath()
    let service = open(path)
    const request: SaveDraftRequest = envelope({
      id: randomUUID(),
      expectedRevision: 0,
      captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: '', bodyMarkdown: '草稿一' }
    })
    const first = service.saveDraft(request).value
    close(service)

    service = open(path, '2026-09-21T04:00:00.000Z')
    expect(service.getDraft(first.id)).toEqual(first)
    const second = service.saveDraft(envelope({
      ...request.payload,
      expectedRevision: 1,
      payload: { kind: 'note' as const, title: '', bodyMarkdown: '草稿二' }
    })).value
    expect(second.revision).toBe(2)
    expect(() => service.saveDraft(envelope({
      ...request.payload,
      expectedRevision: 1
    }))).toThrow(StorageConflictError)
    expect(service.getDraft(first.id)?.payload).toMatchObject({ bodyMarkdown: '草稿二' })
    expect(service.getHistory({ type: 'note', id: first.id })).toEqual([])

    const partialSchedule = service.saveDraft(envelope({
      id: randomUUID(),
      expectedRevision: 0,
      captureKind: 'schedule' as const,
      payload: {
        kind: 'timed-schedule' as const,
        title: '',
        bodyMarkdown: '尚未选择时间',
        startAtUtc: null,
        endAtUtc: null
      }
    })).value
    expect(service.getDraft(partialSchedule.id)).toEqual(partialSchedule)
  })

  test('S3-D10 keeps idempotency and rollback boundaries exact', async () => {
    const path = await databasePath()
    const service = open(path)
    const idempotencyKey = randomUUID()
    const request = taskRequest({}, idempotencyKey)
    const first = service.createTask(request)
    const replay = service.createTask({ ...request, requestId: randomUUID() })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(service.getDataRevision()).toBe(1)
    expect(service.getHistory({ type: 'task', id: request.payload.id })).toHaveLength(1)

    expect(() => service.createTask(taskRequest({ id: randomUUID() }, idempotencyKey)))
      .toThrow(IdempotencyConflictError)
    expect(() => service.createTask(taskRequest({ id: request.payload.id }))).toThrow()
    expect(service.getDataRevision()).toBe(1)
    expect(service.getHistory({ type: 'task', id: request.payload.id })).toHaveLength(1)
  })

  test('persists appearance settings with idempotent changes', async () => {
    const path = await databasePath()
    let service = open(path)
    expect(service.getOrCreateAppearance('zh-CN')).toEqual({ locale: 'zh-CN', theme: 'system' })
    const key = randomUUID()
    const first = service.updateAppearance(envelope({ theme: 'dark' as const }, key))
    const replay = service.updateAppearance(envelope({ theme: 'dark' as const }, key))
    expect(replay).toEqual({ ...first, replayed: true })
    close(service)
    service = open(path)
    expect(service.getOrCreateAppearance('en-US')).toEqual({ locale: 'zh-CN', theme: 'dark' })
  })

  test('migrates a v1 Unicode Note without data loss and backfills its history', async () => {
    const path = await databasePath()
    const noteId = randomUUID()
    const eventId = randomUUID()
    const idempotencyKey = randomUUID()
    const note = {
      id: noteId,
      title: 'v1 中文',
      bodyMarkdown: 'legacy body 🌙',
      createdAtUtc: BASE_INSTANT,
      updatedAtUtc: BASE_INSTANT,
      deletedAtUtc: null
    }
    const change = {
      eventId,
      sequence: 1,
      occurredAtUtc: BASE_INSTANT,
      topics: ['notes'],
      entityRefs: [{ type: 'note', id: noteId }]
    }
    const legacyFingerprint = createHash('sha256').update(JSON.stringify({
      operation: 'notes.create.v1',
      payload: { id: note.id, title: note.title, bodyMarkdown: note.bodyMarkdown }
    }), 'utf8').digest('hex')
    const db = new DatabaseSync(path)
    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE notes (
          id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, body_markdown TEXT NOT NULL,
          created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL, deleted_at_utc TEXT
        ) STRICT;
        CREATE TABLE change_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
          occurred_at_utc TEXT NOT NULL, topics_json TEXT NOT NULL, entity_refs_json TEXT NOT NULL
        ) STRICT;
        CREATE TABLE idempotency_receipts (
          idempotency_key TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL,
          command_fingerprint TEXT NOT NULL, result_note_id TEXT NOT NULL,
          change_sequence INTEGER NOT NULL, result_note_json TEXT NOT NULL,
          result_change_json TEXT NOT NULL, created_at_utc TEXT NOT NULL,
          FOREIGN KEY (result_note_id) REFERENCES notes(id) ON DELETE RESTRICT,
          FOREIGN KEY (change_sequence) REFERENCES change_events(sequence) ON DELETE RESTRICT
        ) STRICT;
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at_utc TEXT NOT NULL
        ) STRICT;
        PRAGMA user_version = 1;
      `)
      db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)').run(
        note.id, note.title, note.bodyMarkdown, note.createdAtUtc, note.updatedAtUtc, null
      )
      db.prepare('INSERT INTO change_events VALUES (?, ?, ?, ?, ?)').run(
        1, eventId, BASE_INSTANT, JSON.stringify(['notes']), JSON.stringify(change.entityRefs)
      )
      db.prepare('INSERT INTO idempotency_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        idempotencyKey, 'notes.create.v1', legacyFingerprint, noteId, 1,
        JSON.stringify(note), JSON.stringify(change), BASE_INSTANT
      )
      db.prepare('INSERT INTO app_settings VALUES (?, ?, ?)').run(
        'app.timeZone', 'Asia/Shanghai', BASE_INSTANT
      )
    } finally {
      db.close()
    }

    const service = open(path)
    expect(service.getNote(noteId)).toMatchObject({ ...note, revision: 1 })
    expect(service.getHistory({ type: 'note', id: noteId })).toMatchObject([{
      operation: 'note.created',
      attributionDate: '2026-09-21',
      attributionTimeZone: 'Asia/Shanghai',
      entityRevision: 1
    }])
    expect(service.createNote({
      requestId: randomUUID(),
      idempotencyKey,
      payload: { id: note.id, title: note.title, bodyMarkdown: note.bodyMarkdown }
    })).toMatchObject({
      replayed: true,
      value: { ...note, revision: 1 },
      change
    })
    close(service)
    const migrated = new DatabaseSync(path)
    try {
      expect((migrated.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
        .toBe(4)
    } finally {
      migrated.close()
    }
  })
})
