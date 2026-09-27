import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { CoreDataService } from '../../src/main/services/core-data-service'
import { FixedClock } from '../../src/shared/clock'
import type { Draft } from '../../src/shared/model'

const roots = new Set<string>()
const services = new Set<CoreDataService>()
async function pathForTest() {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-s7-json-'))
  roots.add(root)
  return join(root, 'quietdesk.sqlite3')
}
function open(path: string) {
  const service = new CoreDataService({ databasePath: path, clock: new FixedClock('2026-09-21T03:00:00.000Z') })
  services.add(service)
  service.getOrCreateAppTimeZone('Asia/Shanghai')
  return service
}
function close(service: CoreDataService) { service.close(); services.delete(service) }
function command<T>(payload: T) {
  return { requestId: randomUUID(), idempotencyKey: randomUUID(), payload }
}
function inspect<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path)
  try { return work(db) } finally { db.close() }
}
function counts(path: string) {
  return inspect(path, (db) => ['drafts', 'notes', 'operation_history', 'change_events', 'idempotency_receipts']
    .map((table) => db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count))
}
afterEach(async () => {
  for (const service of services) service.close()
  services.clear()
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
})

describe('S7-R-DATA-01/02 real SQLite JSON derived limits', () => {
  test.each([
    { kind: 'task', captureKind: 'task', planDate: '2026-09-21', dueDate: '2026-09-22' },
    { kind: 'timed-schedule', captureKind: 'schedule', startAtUtc: '2026-09-21T03:00:00.000Z', endAtUtc: '2026-09-22T03:00:00.000Z' },
    { kind: 'all-day-schedule', captureKind: 'schedule', startDate: '2026-09-21', endDateExclusive: '2026-09-22' }
  ] as const)('worst JSON escaping fits the $kind draft and entity snapshot', async (spec) => {
    const path = await pathForTest()
    const service = open(path)
    const { captureKind, ...fields } = spec
    const payload: Draft['payload'] = { ...fields, title: '\u0001'.repeat(500), bodyMarkdown: '\u0001'.repeat(1_000_000) }
    expect(JSON.stringify(payload).length).toBeGreaterThan(6_003_000)
    expect(JSON.stringify(payload).length).toBeLessThan(6_010_000)
    const request = command({ id: randomUUID(), expectedRevision: 0, captureKind, payload })
    const first = service.saveDraft(request).value
    const second = service.saveDraft(command({ ...request.payload, expectedRevision: 1 })).value
    expect(second.revision).toBe(first.revision + 1)
    expect(service.getDraft(second.id)).toEqual(second)
    const result = service.submitDraft(command({ draftId: second.id, expectedRevision: 2, entityId: randomUUID() }))
    const snapshot = result.value.entity
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(6_003_000)
    expect(JSON.stringify(snapshot).length).toBeLessThan(6_010_000)
    expect(service.getHistory({ type: snapshot.type, id: snapshot.value.id })[0]?.snapshot).toEqual(snapshot)
  })

  test.each([
    { label: 'quotes', character: '"' },
    { label: 'newlines', character: '\n' },
    { label: 'six-character escaped controls', character: '\u0001' }
  ])('legal maximum draft $label saves, reads, submits and persists history', async ({ character }) => {
    const path = await pathForTest()
    let service = open(path)
    const title = '\u0001'.repeat(500)
    const bodyMarkdown = character.repeat(1_000_000)
    const request = command({
      id: randomUUID(), expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title, bodyMarkdown }
    })
    const before = counts(path)
    let saved
    try { saved = service.saveDraft(request) } catch (error) {
      expect(counts(path)).toEqual(before)
      expect(service.getDataRevision()).toBe(0)
      expect(service.getDraft(request.payload.id)).toBeUndefined()
      throw error
    }
    expect(service.getDraft(request.payload.id)).toEqual(saved.value)
    expect(service.saveDraft(request).replayed).toBe(true)
    close(service)
    service = open(path)
    expect(service.getDraft(request.payload.id)).toEqual(saved.value)
    const submit = command({ draftId: request.payload.id, expectedRevision: 1, entityId: randomUUID() })
    const result = service.submitDraft(submit)
    expect(result.value.entity.value).toMatchObject({ title, bodyMarkdown, revision: 1 })
    expect(service.getDraft(request.payload.id)).toBeUndefined()
    expect(service.getHistory({ type: 'note', id: submit.payload.entityId })[0]?.snapshot)
      .toEqual(result.value.entity)
    expect(service.submitDraft(submit).replayed).toBe(true)
    expect(service.getDataRevision()).toBe(2)
    close(service)
    service = open(path)
    expect(service.getNote(submit.payload.entityId)).toEqual(result.value.entity.value)
    expect(service.getHistory({ type: 'note', id: submit.payload.entityId })[0]?.snapshot)
      .toEqual(result.value.entity)
  })

  test.each(['"', '\u0001'])('legal maximum entity %j creates and updates complete history', async (character) => {
    const path = await pathForTest()
    let service = open(path)
    const title = '\u0001'.repeat(500)
    const bodyMarkdown = character.repeat(1_000_000)
    const request = command({ id: randomUUID(), title, bodyMarkdown })
    const before = counts(path)
    let created
    try { created = service.createNote(request).value } catch (error) {
      expect(counts(path)).toEqual(before)
      expect(service.getNote(request.payload.id)).toBeUndefined()
      expect(service.getDataRevision()).toBe(0)
      throw error
    }
    const updated = service.updateNote(command({
      id: created.id, expectedRevision: 1, title, bodyMarkdown: '\u0002'.repeat(1_000_000)
    })).value
    expect(updated.revision).toBe(2)
    expect(service.getHistory({ type: 'note', id: created.id }).map((row) => row.snapshot.value))
      .toEqual([created, updated])
    close(service)
    service = open(path)
    expect(service.getNote(created.id)).toEqual(updated)
    expect(service.getHistory({ type: 'note', id: created.id }).map((row) => row.snapshot.value))
      .toEqual([created, updated])
  })

  test('late failures do not drift entity/draft revision, changes or receipts', async () => {
    const path = await pathForTest()
    const service = open(path)
    const note = service.createNote(command({ id: randomUUID(), title: 'before', bodyMarkdown: 'before' })).value
    const draft = service.saveDraft(command({
      id: randomUUID(), expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'before', bodyMarkdown: 'before' }
    })).value
    const before = counts(path)
    const revision = service.getDataRevision()
    inspect(path, (db) => db.exec(`
      CREATE TRIGGER fail_s7_receipt BEFORE INSERT ON idempotency_receipts
      BEGIN SELECT RAISE(ABORT, 's7 late receipt failure'); END;
    `))
    expect(() => service.updateNote(command({
      id: note.id, expectedRevision: 1, title: 'after', bodyMarkdown: '\u0001'.repeat(1_000_000)
    }))).toThrow(/s7 late receipt failure/u)
    expect(() => service.saveDraft(command({
      id: draft.id, expectedRevision: 1, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'after', bodyMarkdown: '\u0001'.repeat(1_000_000) }
    }))).toThrow(/s7 late receipt failure/u)
    expect(() => service.submitDraft(command({
      draftId: draft.id, expectedRevision: 1, entityId: randomUUID()
    }))).toThrow(/s7 late receipt failure/u)
    expect(counts(path)).toEqual(before)
    expect(service.getDataRevision()).toBe(revision)
    expect(service.getNote(note.id)).toEqual(note)
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getHistory({ type: 'note', id: note.id })).toHaveLength(1)
  })

  test('v4 to v5 preserves all stored rows and constraints across restart', async () => {
    const path = await pathForTest()
    let service = open(path)
    const note = service.createNote(command({ id: randomUUID(), title: 'migration', bodyMarkdown: 'original' })).value
    const draft = service.saveDraft(command({
      id: randomUUID(), expectedRevision: 0, captureKind: 'note' as const,
      payload: { kind: 'note' as const, title: 'draft', bodyMarkdown: 'unsent' }
    })).value
    service.saveDailyLogManual(command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: 'manual migration'
    }))
    const log = service.getOrGenerateDailyLog('2026-09-21')
    const tables = ['drafts', 'notes', 'operation_history', 'change_events', 'idempotency_receipts', 'daily_logs', 'daily_log_items']
    close(service)
    const before = inspect(path, (db) => {
      // Build an actual v4 fixture with the original CHECKs, not just a version marker.
      for (const [table, column, limit] of [
        ['drafts', 'payload_json', '1000000'], ['operation_history', 'snapshot_json', '2000000']
      ]) {
        const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table!) as { sql: string }
        const sql = row.sql.replace(new RegExp(`CREATE TABLE "?${table}"?`, 'u'), `CREATE TABLE ${table}_fixture`)
          .replace(new RegExp(`length\\(${column}\\) <= \\d+`, 'u'), `length(${column}) <= ${limit}`)
        db.exec(`${sql}; INSERT INTO ${table}_fixture SELECT * FROM ${table};
          DROP TABLE ${table}; ALTER TABLE ${table}_fixture RENAME TO ${table};`)
      }
      db.exec(`CREATE INDEX idx_history_entity ON operation_history(entity_type, entity_id, sequence);
        CREATE INDEX idx_history_date ON operation_history(attribution_date, sequence);
        CREATE INDEX idx_history_cutoff ON operation_history(occurred_at_utc, sequence);
        PRAGMA user_version = 4;`)
      return tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
    })
    service = open(path)
    inspect(path, (db) => {
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 5 })
      expect(tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(before)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.prepare('PRAGMA foreign_key_list(operation_history)').all())
        .toMatchObject([{ table: 'change_events', from: 'sequence', on_delete: 'RESTRICT' }])
      expect(db.prepare('PRAGMA foreign_key_list(daily_log_items)').all())
        .toMatchObject([{ table: 'daily_logs', from: 'log_date', on_delete: 'CASCADE' }])
      for (const index of ['idx_history_entity', 'idx_history_date', 'idx_history_cutoff']) {
        expect(db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('index', index))
          .toMatchObject({ name: index })
      }
      expect(() => db.prepare(`INSERT INTO operation_history SELECT ?, sequence, entity_type, entity_id,
        operation, occurred_at_utc, attribution_date, attribution_time_zone, entity_revision, snapshot_json
        FROM operation_history LIMIT 1`).run(randomUUID())).toThrow(/UNIQUE/u)
      db.exec('PRAGMA foreign_keys = ON')
      expect(() => db.prepare('DELETE FROM change_events WHERE sequence = ?').run(1)).toThrow(/FOREIGN KEY/u)
      for (const [table, column] of [['drafts', 'payload_json'], ['operation_history', 'snapshot_json']]) {
        db.exec('BEGIN')
        try {
          db.prepare(`UPDATE ${table} SET ${column} = ?`).run('x'.repeat(6_010_000))
          expect(() => db.prepare(`UPDATE ${table} SET ${column} = ?`).run('x'.repeat(6_010_001)))
            .toThrow(/CHECK/u)
        } finally { db.exec('ROLLBACK') }
      }
    })
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getOrGenerateDailyLog(log.logDate)).toEqual(log)
    service.updateNote(command({ id: note.id, expectedRevision: 1, title: 'migration', bodyMarkdown: '\u0001'.repeat(1_000_000) }))
    close(service)
    service = open(path)
    expect(service.getDraft(draft.id)).toEqual(draft)
    expect(service.getHistory({ type: 'note', id: note.id })[1]?.snapshot.value.bodyMarkdown)
      .toBe('\u0001'.repeat(1_000_000))
    expect(service.getOrGenerateDailyLog(log.logDate).manualMarkdown).toBe('manual migration')
  })
})
