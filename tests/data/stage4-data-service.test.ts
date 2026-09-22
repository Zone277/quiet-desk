import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { FixedClock } from '../../src/shared/clock'
import type { CaptureDraftPayload, CaptureKind } from '../../src/shared/model'
import {
  defaultCaptureShortcut,
  type SaveDraftRequest,
  type SubmitDraftRequest,
  type UpdateShortcutRequest
} from '../../src/shared/ipc-contract'
import {
  CoreDataService,
  IdempotencyConflictError,
  StorageConflictError
} from '../../src/main/services/core-data-service'

const FIXED_INSTANT = '2026-09-22T03:04:05.678Z'
const temporaryRoots = new Set<string>()
const services = new Set<CoreDataService>()

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-stage4-data-'))
  temporaryRoots.add(root)
  return join(root, 'nested', 'quietdesk.sqlite3')
}

function open(path: string): CoreDataService {
  const service = new CoreDataService({
    databasePath: path,
    clock: new FixedClock(FIXED_INSTANT)
  })
  services.add(service)
  return service
}

function close(service: CoreDataService): void {
  service.close()
  services.delete(service)
}

function envelope<T>(payload: T, idempotencyKey = randomUUID()) {
  return { requestId: randomUUID(), idempotencyKey, payload }
}

function saveDraft(
  service: CoreDataService,
  captureKind: CaptureKind,
  payload: CaptureDraftPayload,
  id = randomUUID()
) {
  const request: SaveDraftRequest = envelope({
    id,
    expectedRevision: 0,
    captureKind,
    payload
  })
  return service.saveDraft(request).value
}

function submitRequest(
  draftId: string,
  entityId = randomUUID(),
  idempotencyKey = randomUUID(),
  expectedRevision = 1
): SubmitDraftRequest {
  return envelope({ draftId, expectedRevision, entityId }, idempotencyKey)
}

afterEach(async () => {
  for (const service of services) service.close()
  services.clear()
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  temporaryRoots.clear()
})

describe('CoreDataService stage 4 draft submission', () => {
  test.each([
    {
      label: 'note',
      captureKind: 'note' as const,
      entityType: 'note' as const,
      operation: 'note.created' as const,
      topic: 'notes' as const,
      payload: {
        kind: 'note' as const,
        title: '',
        bodyMarkdown: '# 快速记录\n\n中英文 mixed note 🌙'
      }
    },
    {
      label: 'task',
      captureKind: 'task' as const,
      entityType: 'task' as const,
      operation: 'task.created' as const,
      topic: 'tasks' as const,
      payload: {
        kind: 'task' as const,
        title: '  提交阶段四任务  ',
        bodyMarkdown: '- [ ] 保持 Markdown',
        planDate: '2026-09-22',
        dueDate: null
      }
    },
    {
      label: 'timed schedule',
      captureKind: 'schedule' as const,
      entityType: 'schedule' as const,
      operation: 'schedule.created' as const,
      topic: 'schedules' as const,
      payload: {
        kind: 'timed-schedule' as const,
        title: '跨午夜安排',
        bodyMarkdown: '计划，不代表已参加',
        startAtUtc: '2026-09-22T15:30:00.000Z',
        endAtUtc: '2026-09-22T16:30:00.000Z'
      }
    },
    {
      label: 'all-day schedule',
      captureKind: 'schedule' as const,
      entityType: 'schedule' as const,
      operation: 'schedule.created' as const,
      topic: 'schedules' as const,
      payload: {
        kind: 'all-day-schedule' as const,
        title: '多日全天安排',
        bodyMarkdown: '',
        startDate: '2026-09-22',
        endDateExclusive: '2026-09-24'
      }
    }
  ])('submits a persisted $label payload with one entity+draft change', async (spec) => {
    const path = await databasePath()
    const service = open(path)
    service.getOrCreateAppTimeZone('Asia/Shanghai')
    const draft = saveDraft(service, spec.captureKind, spec.payload)
    const request = submitRequest(draft.id)

    const result = service.submitDraft(request)

    expect(result.replayed).toBe(false)
    expect(result.value).toMatchObject({
      entity: {
        type: spec.entityType,
        value: { id: request.payload.entityId, revision: 1 }
      },
      submittedDraftRevision: 1
    })
    expect(result.change).toMatchObject({
      topics: [spec.topic, 'drafts'],
      entityRefs: [
        { type: spec.entityType, id: request.payload.entityId },
        { type: 'draft', id: draft.id }
      ]
    })
    expect(service.getDraft(draft.id)).toBeUndefined()
    expect(service.getEntity({ type: spec.entityType, id: request.payload.entityId }))
      .toEqual(result.value.entity)
    expect(service.getHistory({ type: spec.entityType, id: request.payload.entityId }))
      .toMatchObject([{
        sequence: result.change.sequence,
        operation: spec.operation,
        entityRevision: 1,
        snapshot: result.value.entity
      }])
  })

  test('rejects a stale expected revision without changing or deleting the draft', async () => {
    const path = await databasePath()
    const service = open(path)
    const draft = saveDraft(service, 'note', {
      kind: 'note', title: 'revision', bodyMarkdown: 'must remain'
    })
    const entityId = randomUUID()

    expect(() => service.submitDraft(submitRequest(draft.id, entityId, randomUUID(), 2)))
      .toThrow(StorageConflictError)
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getEntity({ type: 'note', id: entityId })).toBeUndefined()
    expect(service.getHistory({ type: 'note', id: entityId })).toEqual([])
    expect(service.getDataRevision()).toBe(1)
  })

  test.each([
    {
      label: 'empty note',
      captureKind: 'note' as const,
      entityType: 'note' as const,
      reason: 'empty-note',
      payload: { kind: 'note' as const, title: '  ', bodyMarkdown: '\n\t' }
    },
    {
      label: 'task without a title',
      captureKind: 'task' as const,
      entityType: 'task' as const,
      reason: 'incomplete-task',
      payload: {
        kind: 'task' as const,
        title: ' ',
        bodyMarkdown: 'body is not a task title',
        planDate: null,
        dueDate: null
      }
    },
    {
      label: 'timed schedule without boundaries',
      captureKind: 'schedule' as const,
      entityType: 'schedule' as const,
      reason: 'incomplete-schedule',
      payload: {
        kind: 'timed-schedule' as const,
        title: 'incomplete',
        bodyMarkdown: '',
        startAtUtc: null,
        endAtUtc: null
      }
    },
    {
      label: 'all-day schedule without an end date',
      captureKind: 'schedule' as const,
      entityType: 'schedule' as const,
      reason: 'incomplete-schedule',
      payload: {
        kind: 'all-day-schedule' as const,
        title: 'incomplete',
        bodyMarkdown: '',
        startDate: '2026-09-22',
        endDateExclusive: null
      }
    }
  ])('keeps the persisted draft when formal rules reject $label', async (spec) => {
    const path = await databasePath()
    const service = open(path)
    const draft = saveDraft(service, spec.captureKind, spec.payload)
    const entityId = randomUUID()
    const request = submitRequest(draft.id, entityId)

    let failure: unknown
    try {
      service.submitDraft(request)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(StorageConflictError)
    expect(failure).toMatchObject({ reason: spec.reason })
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getEntity({ type: spec.entityType, id: entityId })).toBeUndefined()
    expect(service.getHistory({ type: spec.entityType, id: entityId })).toEqual([])
    expect(service.getDataRevision()).toBe(1)

    close(service)
    const database = new DatabaseSync(path)
    try {
      const receipt = database.prepare(`
        SELECT count(*) AS count FROM idempotency_receipts WHERE idempotency_key = ?
      `).get(request.idempotencyKey) as { count: number }
      expect(receipt.count).toBe(0)
    } finally {
      database.close()
    }
  })

  test('replays the submit receipt and rejects the same key with a different command', async () => {
    const path = await databasePath()
    const service = open(path)
    const draft = saveDraft(service, 'task', {
      kind: 'task', title: 'once only', bodyMarkdown: '', planDate: null, dueDate: null
    })
    const key = randomUUID()
    const request = submitRequest(draft.id, randomUUID(), key)
    const first = service.submitDraft(request)

    expect(service.submitDraft({ ...request, requestId: randomUUID() }))
      .toEqual({ ...first, replayed: true })
    expect(() => service.submitDraft({
      ...request,
      requestId: randomUUID(),
      payload: { ...request.payload, entityId: randomUUID() }
    })).toThrow(IdempotencyConflictError)
    expect(service.getDataRevision()).toBe(2)
    expect(service.getHistory({ type: 'task', id: request.payload.entityId })).toHaveLength(1)
  })

  test('rolls back entity, history, change, receipt, and draft deletion on a late failure', async () => {
    const path = await databasePath()
    let service = open(path)
    const draft = saveDraft(service, 'note', {
      kind: 'note', title: 'rollback', bodyMarkdown: 'force failure after history is written'
    })
    close(service)

    const setup = new DatabaseSync(path)
    try {
      setup.exec(`
        CREATE TRIGGER force_submit_delete_failure
        BEFORE DELETE ON drafts
        BEGIN
          SELECT RAISE(ABORT, 'forced submit rollback');
        END;
      `)
    } finally {
      setup.close()
    }

    service = open(path)
    const entityId = randomUUID()
    const request = submitRequest(draft.id, entityId)
    expect(() => service.submitDraft(request)).toThrow(/forced submit rollback/u)
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getEntity({ type: 'note', id: entityId })).toBeUndefined()
    expect(service.getHistory({ type: 'note', id: entityId })).toEqual([])
    expect(service.getDataRevision()).toBe(1)

    close(service)
    const database = new DatabaseSync(path)
    try {
      const receipt = database.prepare(`
        SELECT count(*) AS count FROM idempotency_receipts WHERE idempotency_key = ?
      `).get(request.idempotencyKey) as { count: number }
      expect(receipt.count).toBe(0)
    } finally {
      database.close()
    }
  })
})

describe('CoreDataService stage 4 capture shortcut persistence', () => {
  test('creates the default, updates with a settings change, reopens, and replays idempotently', async () => {
    const path = await databasePath()
    let service = open(path)
    expect(service.getOrCreateCaptureShortcut(defaultCaptureShortcut))
      .toBe(defaultCaptureShortcut)
    expect(service.getDataRevision()).toBe(0)

    const key = randomUUID()
    const request: UpdateShortcutRequest = envelope({ accelerator: 'Alt+Shift+F12' }, key)
    const first = service.updateCaptureShortcut(request)
    expect(first).toMatchObject({
      value: { accelerator: 'Alt+Shift+F12' },
      replayed: false,
      change: { topics: ['settings'], entityRefs: [] }
    })
    expect(service.updateCaptureShortcut({ ...request, requestId: randomUUID() }))
      .toEqual({ ...first, replayed: true })
    expect(service.getDataRevision()).toBe(1)

    close(service)
    service = open(path)
    expect(service.getOrCreateCaptureShortcut('Control+F9')).toBe('Alt+Shift+F12')
    expect(service.updateCaptureShortcut({ ...request, requestId: randomUUID() }))
      .toEqual({ ...first, replayed: true })
    expect(() => service.updateCaptureShortcut(envelope(
      { accelerator: 'Control+F9' },
      key
    ))).toThrow(IdempotencyConflictError)
    expect(service.getDataRevision()).toBe(1)
  })
})
