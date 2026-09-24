import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { FixedClock } from '../../src/shared/clock'
import { CoreDataService, StorageConflictError } from '../../src/main/services/core-data-service'

const roots = new Set<string>()
const services = new Set<CoreDataService>()

async function pathForTest(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-stage5-data-'))
  roots.add(root)
  return join(root, 'nested', 'quietdesk.sqlite3')
}

function open(path: string, instant: string, timeZone = 'Asia/Shanghai'): CoreDataService {
  const service = new CoreDataService({ databasePath: path, clock: new FixedClock(instant) })
  services.add(service)
  service.getOrCreateAppTimeZone(timeZone)
  return service
}

function close(service: CoreDataService): void {
  service.close()
  services.delete(service)
}

function command<T>(payload: T, idempotencyKey = randomUUID()) {
  return { requestId: randomUUID(), idempotencyKey, payload }
}

afterEach(async () => {
  for (const service of services) service.close()
  services.clear()
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
})

describe('Stage 5 Daily Log SQLite', () => {
  test('migrates a populated v2-shaped database to v3 without rebuilding entities', async () => {
    const path = await pathForTest()
    let service = open(path, '2026-09-21T03:00:00.000Z')
    const note = service.createNote(command({
      id: randomUUID(), title: '保留旧笔记', bodyMarkdown: '旧数据 🌙'
    })).value
    close(service)
    const downgradeFixture = new DatabaseSync(path)
    try {
      downgradeFixture.exec(`
        DROP TABLE daily_log_items;
        DROP TABLE daily_logs;
        DROP INDEX idx_history_cutoff;
        PRAGMA user_version = 2;
      `)
    } finally {
      downgradeFixture.close()
    }
    service = open(path, '2026-09-22T03:00:00.000Z')
    expect(service.getNote(note.id)?.bodyMarkdown).toBe('旧数据 🌙')
    expect(service.getOrGenerateDailyLog('2026-09-21').autoItems)
      .toMatchObject([{ section: 'notes', sourceEntityId: note.id }])
    close(service)
    const migrated = new DatabaseSync(path)
    try {
      const version = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(version.user_version).toBe(3)
    } finally {
      migrated.close()
    }
  })

  test('rebuilds historical boundary state without later edits or reopen rewriting it', async () => {
    const path = await pathForTest()
    let service = open(path, '2026-09-21T03:00:00.000Z')
    const task = service.createTask(command({
      id: randomUUID(), title: 'Monday title', bodyMarkdown: '',
      planDate: '2026-09-21', dueDate: '2026-09-25'
    })).value
    const note = service.createNote(command({
      id: randomUUID(), title: 'Monday note', bodyMarkdown: 'original body'
    })).value
    service.createSchedule(command({
      kind: 'timed' as const, id: randomUUID(), title: '跨午夜计划', bodyMarkdown: '',
      startAtUtc: '2026-09-21T15:30:00.000Z',
      endAtUtc: '2026-09-21T16:30:00.000Z'
    }))
    const monday = service.getOrGenerateDailyLog('2026-09-21')
    expect(monday.autoItems.map((item) => item.section))
      .toEqual(['pending-at-boundary', 'planned', 'notes'])
    expect(service.getOrGenerateDailyLog('2026-09-22').autoItems.map((item) => item.section))
      .toEqual(['planned'])
    close(service)

    service = open(path, '2026-09-22T03:00:00.000Z')
    service.setTaskCompletion(command({ id: task.id, expectedRevision: 1, action: 'complete' as const }))
    service.updateNote(command({
      id: note.id, expectedRevision: 1, title: 'Tuesday edit', bodyMarkdown: 'new body'
    }))
    const tuesday = service.getOrGenerateDailyLog('2026-09-22')
    expect(tuesday.autoItems.some((item) => item.section === 'completed' && item.sourceEntityId === task.id))
      .toBe(true)
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(monday)
    close(service)

    service = open(path, '2026-09-23T03:00:00.000Z')
    service.setTaskCompletion(command({ id: task.id, expectedRevision: 2, action: 'reopen' as const }))
    service.updateTask(command({
      id: task.id, expectedRevision: 3, title: 'Wednesday title', bodyMarkdown: '',
      planDate: '2026-09-24', dueDate: null
    }))
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(monday)
    expect(service.getOrGenerateDailyLog('2026-09-22')).toEqual(tuesday)
    expect(service.renderDailyLogMarkdown('2026-09-21')).toContain('original body')
    expect(service.renderDailyLogMarkdown('2026-09-21')).not.toContain('Wednesday title')
  })

  test('same-timestamp complete then reopen remains pending and keeps ordered history', async () => {
    const path = await pathForTest()
    const service = open(path, '2026-09-21T03:00:00.000Z')
    const task = service.createTask(command({
      id: randomUUID(), title: '同日任务', bodyMarkdown: '', planDate: null, dueDate: null
    })).value
    expect(service.getOrGenerateDailyLog('2026-09-21').autoItems.map((item) => item.section))
      .toEqual(['pending-at-boundary'])
    service.setTaskCompletion(command({ id: task.id, expectedRevision: 1, action: 'complete' as const }))
    expect(service.getOrGenerateDailyLog('2026-09-21').autoItems.map((item) => item.section))
      .toEqual(['completed'])
    service.setTaskCompletion(command({ id: task.id, expectedRevision: 2, action: 'reopen' as const }))
    const log = service.getOrGenerateDailyLog('2026-09-21')
    expect(log.autoItems.map((item) => item.section)).toEqual(['pending-at-boundary'])
    expect(service.getHistory({ type: 'task', id: task.id }).map((item) => item.operation))
      .toEqual(['task.created', 'task.completed', 'task.reopened'])
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(log)
  })

  test('manual text has independent revision and survives automatic regeneration', async () => {
    const path = await pathForTest()
    const service = open(path, '2026-09-21T03:00:00.000Z')
    const before = service.getOrGenerateDailyLog('2026-09-21')
    expect(before.manualRevision).toBe(0)
    const request = command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: '手写 secret 🌙'
    })
    const saved = service.saveDailyLogManual(request)
    expect(saved.value.manualRevision).toBe(1)
    expect(service.saveDailyLogManual({ ...request, requestId: randomUUID() }).replayed).toBe(true)
    expect(() => service.saveDailyLogManual(command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: 'stale'
    }))).toThrow(StorageConflictError)
    service.createNote(command({ id: randomUUID(), title: 'new note', bodyMarkdown: 'body' }))
    const updated = service.getOrGenerateDailyLog('2026-09-21')
    expect(updated.manualMarkdown).toBe('手写 secret 🌙')
    expect(updated.manualRevision).toBe(1)
    expect(updated.autoItems).toHaveLength(1)
    expect(service.renderDailyLogMarkdown('2026-09-21')).toContain('手写 secret 🌙')
  })

  test('does not truncate a note body at the Markdown field limit', async () => {
    const path = await pathForTest()
    const service = open(path, '2026-09-21T03:00:00.000Z')
    const body = '文'.repeat(1_000_000)
    service.createNote(command({ id: randomUUID(), title: '标题', bodyMarkdown: body }))
    const item = service.getOrGenerateDailyLog('2026-09-21').autoItems[0]
    expect(item?.snapshotMarkdown).toBe(body)
  })

  test('trash hides, restore rebuilds, permanent deletion purges draft and log receipts', async () => {
    const path = await pathForTest()
    const service = open(path, '2026-09-21T03:00:00.000Z')
    const draftId = randomUUID()
    const draft = service.saveDraft(command({
      id: draftId, expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'secret-title', bodyMarkdown: 'secret-body' }
    })).value
    const noteId = randomUUID()
    service.submitDraft(command({ draftId, expectedRevision: draft.revision, entityId: noteId }))
    const original = service.getOrGenerateDailyLog('2026-09-21')
    const manual = service.saveDailyLogManual(command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: 'secret-title 手写保留'
    }))
    expect(original.autoItems.some((item) => item.sourceEntityId === noteId)).toBe(true)
    const trashed = service.trashEntity(command({
      entity: { type: 'note' as const, id: noteId }, expectedRevision: 1
    })).value
    expect(service.getOrGenerateDailyLog('2026-09-21').autoItems).toEqual([])
    const restored = service.restoreEntity(command({
      entity: { type: 'note' as const, id: noteId }, expectedRevision: trashed.value.revision
    })).value
    expect(service.getOrGenerateDailyLog('2026-09-21').autoItems).toHaveLength(1)
    const trashedAgain = service.trashEntity(command({
      entity: { type: 'note' as const, id: noteId }, expectedRevision: restored.value.revision
    })).value
    service.permanentlyDeleteEntity(command({
      entity: { type: 'note' as const, id: noteId },
      expectedRevision: trashedAgain.value.revision, confirmedEntityId: noteId
    }))
    expect(service.getOrGenerateDailyLog('2026-09-21').manualMarkdown)
      .toBe('secret-title 手写保留')
    expect(service.renderDailyLogMarkdown('2026-09-21')).not.toContain('secret-body')
    close(service)
    const db = new DatabaseSync(path)
    try {
      const rows = db.prepare(`
        SELECT result_json FROM idempotency_receipts
        WHERE (subject_type = 'draft' AND subject_id = ?)
           OR (subject_type = 'daily-log' AND subject_id = ?)
      `).all(draftId, manual.value.id) as Array<{ result_json: string | null }>
      expect(rows.every((row) => row.result_json === null)).toBe(true)
      const itemCount = db.prepare(`
        SELECT count(*) AS count FROM daily_log_items WHERE source_entity_id = ?
      `).get(noteId) as { count: number }
      expect(itemCount.count).toBe(0)
    } finally {
      db.close()
    }
  })

  test('reconcile catches an ongoing task on gap dates after downtime', async () => {
    const path = await pathForTest()
    let service = open(path, '2026-09-21T03:00:00.000Z')
    service.createTask(command({
      id: randomUUID(), title: 'ongoing', bodyMarkdown: '', planDate: null, dueDate: null
    }))
    close(service)
    service = open(path, '2026-09-24T03:00:00.000Z')
    expect(service.reconcileActiveDailyLogs()).toBe(4)
    expect(service.getOrGenerateDailyLog('2026-09-22').autoItems)
      .toMatchObject([{ section: 'pending-at-boundary' }])
    close(service)
    const db = new DatabaseSync(path)
    try {
      const dates = db.prepare('SELECT log_date FROM daily_logs ORDER BY log_date')
        .all() as Array<{ log_date: string }>
      expect(dates.map((row) => row.log_date)).toEqual([
        '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'
      ])
    } finally {
      db.close()
    }
  })

  test('DST day boundaries and empty downtime days are handled separately', async () => {
    const path = await pathForTest()
    let service = open(path, '2026-03-07T12:00:00.000Z', 'America/New_York')
    service.createSchedule(command({
      kind: 'timed' as const, id: randomUUID(), title: 'DST overlap', bodyMarkdown: '',
      startAtUtc: '2026-03-09T03:30:00.000Z',
      endAtUtc: '2026-03-09T04:30:00.000Z'
    }))
    close(service)
    service = open(path, '2026-03-10T12:00:00.000Z', 'America/New_York')
    expect(service.reconcileActiveDailyLogs()).toBe(2)
    expect(service.getOrGenerateDailyLog('2026-03-08').autoItems.map((item) => item.section))
      .toEqual(['planned'])
    expect(service.getOrGenerateDailyLog('2026-03-09').autoItems.map((item) => item.section))
      .toEqual(['planned'])
    close(service)
    const db = new DatabaseSync(path)
    try {
      const dates = db.prepare('SELECT log_date FROM daily_logs ORDER BY log_date')
        .all() as Array<{ log_date: string }>
      expect(dates.map((row) => row.log_date)).toEqual(['2026-03-08', '2026-03-09'])
    } finally {
      db.close()
    }
  })

  test('purges only the deleted submission interval when Capture reuses its draft ID', async () => {
    const path = await pathForTest()
    const service = open(path, '2026-09-21T03:00:00.000Z')
    const draftId = randomUUID()
    const firstSave = command({
      id: draftId, expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'first', bodyMarkdown: 'first private body' }
    })
    service.saveDraft(firstSave)
    const firstId = randomUUID()
    service.submitDraft(command({ draftId, expectedRevision: 1, entityId: firstId }))

    const secondSave = command({
      id: draftId, expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'second', bodyMarkdown: 'second retained body' }
    })
    service.saveDraft(secondSave)
    const secondId = randomUUID()
    service.submitDraft(command({ draftId, expectedRevision: 1, entityId: secondId }))

    const trashed = service.trashEntity(command({
      entity: { type: 'note' as const, id: firstId }, expectedRevision: 1
    })).value
    service.permanentlyDeleteEntity(command({
      entity: { type: 'note' as const, id: firstId },
      expectedRevision: trashed.value.revision, confirmedEntityId: firstId
    }))
    close(service)
    const db = new DatabaseSync(path)
    try {
      const first = db.prepare('SELECT result_json FROM idempotency_receipts WHERE idempotency_key = ?')
        .get(firstSave.idempotencyKey) as { result_json: string | null }
      const second = db.prepare('SELECT result_json FROM idempotency_receipts WHERE idempotency_key = ?')
        .get(secondSave.idempotencyKey) as { result_json: string | null }
      expect(first.result_json).toBeNull()
      expect(second.result_json).toContain('second retained body')
    } finally {
      db.close()
    }
  })
})
