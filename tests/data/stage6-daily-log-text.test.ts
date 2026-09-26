import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { dailyLogToMarkdown, formatDailyLogInstant } from '../../src/domain/daily-log-markdown'
import { CoreDataService } from '../../src/main/services/core-data-service'
import { FixedClock } from '../../src/shared/clock'
import { dailyLogItemSchema } from '../../src/shared/model'

const roots = new Set<string>()
const services = new Set<CoreDataService>()

async function pathForTest(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-stage6-data-'))
  roots.add(root)
  return join(root, 'quietdesk.sqlite3')
}

function open(path: string, instant = '2026-09-21T03:00:00.000Z'): CoreDataService {
  const service = new CoreDataService({ databasePath: path, clock: new FixedClock(instant) })
  services.add(service)
  service.getOrCreateAppTimeZone('Asia/Shanghai')
  return service
}

function close(service: CoreDataService): void {
  service.close()
  services.delete(service)
}

function command<T>(payload: T) {
  return { requestId: randomUUID(), idempotencyKey: randomUUID(), payload }
}

afterEach(async () => {
  for (const service of services) service.close()
  services.clear()
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
})

describe('Stage 6 Daily Log text with real SQLite', () => {
  test('v3 to v4 preserves stored logs, links, indexes and deletion constraints', async () => {
    const path = await pathForTest()
    let service = open(path)
    const note = service.createNote(command({
      id: randomUUID(), title: 'Migration note', bodyMarkdown: 'Original body'
    })).value
    service.saveDailyLogManual(command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: 'Migration note 手写保留'
    }))
    const log = service.getOrGenerateDailyLog('2026-09-21')
    const history = service.getHistory({ type: 'note', id: note.id })
    close(service)
    const fixture = new DatabaseSync(path)
    let storedLogs: unknown
    let storedItems: unknown
    let storedReceipts: unknown
    try {
      const schema = fixture.prepare("SELECT sql FROM sqlite_master WHERE name = 'daily_log_items'")
        .get() as { sql: string }
      const v3Schema = schema.sql.replace(/CREATE TABLE "?daily_log_items"?/u,
        'CREATE TABLE daily_log_items_v3_fixture').replace('1002000', '1000000')
      expect(v3Schema).toContain('length(snapshot_markdown) <= 1000000')
      fixture.exec(`
        BEGIN IMMEDIATE;
        ${v3Schema};
        INSERT INTO daily_log_items_v3_fixture SELECT * FROM daily_log_items;
        DROP TABLE daily_log_items;
        ALTER TABLE daily_log_items_v3_fixture RENAME TO daily_log_items;
        CREATE INDEX idx_daily_log_items_source ON daily_log_items(source_entity_type, source_entity_id);
        PRAGMA user_version = 3;
        COMMIT;
      `)
      storedLogs = fixture.prepare('SELECT * FROM daily_logs ORDER BY log_date').all()
      storedItems = fixture.prepare('SELECT * FROM daily_log_items ORDER BY id').all()
      storedReceipts = fixture.prepare('SELECT * FROM idempotency_receipts ORDER BY idempotency_key').all()
    } finally {
      fixture.close()
    }
    service = open(path, '2026-09-22T03:00:00.000Z')
    const migrated = new DatabaseSync(path)
    try {
      migrated.exec('PRAGMA foreign_keys = ON')
      expect(migrated.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 })
      expect(migrated.prepare('SELECT * FROM daily_logs ORDER BY log_date').all()).toEqual(storedLogs)
      expect(migrated.prepare('SELECT * FROM daily_log_items ORDER BY id').all()).toEqual(storedItems)
      expect(migrated.prepare('SELECT * FROM idempotency_receipts ORDER BY idempotency_key').all())
        .toEqual(storedReceipts)
      expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(migrated.prepare('PRAGMA foreign_key_list(daily_log_items)').all())
        .toMatchObject([{ table: 'daily_logs', from: 'log_date', to: 'log_date', on_delete: 'CASCADE' }])
      expect(migrated.prepare('PRAGMA index_info(idx_daily_log_items_source)').all()
        .map((row) => row.name)).toEqual(['source_entity_type', 'source_entity_id'])
      expect(() => migrated.prepare(`
        INSERT INTO daily_log_items SELECT ?, log_date, section, source_entity_type,
          source_entity_id, source_operation_id, stable_order, snapshot_markdown
        FROM daily_log_items WHERE id = ?
      `).run(randomUUID(), log.autoItems[0]!.id)).toThrow(/UNIQUE/u)
      migrated.exec('BEGIN IMMEDIATE')
      try {
        migrated.prepare('UPDATE daily_log_items SET snapshot_markdown = ? WHERE id = ?')
          .run('a'.repeat(1_002_000), log.autoItems[0]!.id)
        expect(() => migrated.prepare('UPDATE daily_log_items SET snapshot_markdown = ? WHERE id = ?')
          .run('a'.repeat(1_002_001), log.autoItems[0]!.id)).toThrow(/CHECK/u)
        migrated.prepare('DELETE FROM daily_logs WHERE log_date = ?').run(log.logDate)
        expect(migrated.prepare('SELECT count(*) AS count FROM daily_log_items').get())
          .toMatchObject({ count: 0 })
      } finally {
        migrated.exec('ROLLBACK')
      }
    } finally {
      migrated.close()
    }
    expect(service.getOrGenerateDailyLog(log.logDate)).toEqual(log)
    expect(service.getHistory({ type: 'note', id: note.id })).toEqual(history)
    const trashed = service.trashEntity(command({
      entity: { type: 'note' as const, id: note.id }, expectedRevision: 1
    })).value
    expect(service.getOrGenerateDailyLog(log.logDate).autoItems).toEqual([])
    const restored = service.restoreEntity(command({
      entity: { type: 'note' as const, id: note.id }, expectedRevision: trashed.value.revision
    })).value
    expect(service.getOrGenerateDailyLog(log.logDate).autoItems[0]).toMatchObject({
      sourceEntityId: note.id, sourceOperationId: log.autoItems[0]!.sourceOperationId,
      snapshotMarkdown: log.autoItems[0]!.snapshotMarkdown
    })
    const trashedAgain = service.trashEntity(command({
      entity: { type: 'note' as const, id: note.id }, expectedRevision: restored.value.revision
    })).value
    service.permanentlyDeleteEntity(command({
      entity: { type: 'note' as const, id: note.id }, expectedRevision: trashedAgain.value.revision,
      confirmedEntityId: note.id
    }))
    close(service)
    service = open(path, '2026-09-23T03:00:00.000Z')
    const deleted = service.getOrGenerateDailyLog(log.logDate)
    expect(deleted.autoItems).toEqual([])
    expect(deleted.manualMarkdown).toBe(log.manualMarkdown)
    expect(deleted.manualRevision).toBe(log.manualRevision)
    expect(service.getHistory({ type: 'note', id: note.id })).toEqual([])
    expect(service.renderDailyLogMarkdown(log.logDate)).not.toContain('Original body')
  })

  test('uses neutral half-open intervals and preserves historical source snapshots', async () => {
    const path = await pathForTest()
    let service = open(path)
    const timed = service.createSchedule(command({
      kind: 'timed' as const, id: randomUUID(), title: 'Night *shift*',
      bodyMarkdown: '计划：user body（结束日不含）',
      startAtUtc: '2026-09-21T15:30:00.000Z', endAtUtc: '2026-09-21T16:30:00.000Z'
    })).value
    const allDay = service.createSchedule(command({
      kind: 'all-day' as const, id: randomUUID(), title: 'Trip', bodyMarkdown: '',
      startDate: '2026-09-21', endDateExclusive: '2026-09-23'
    })).value
    const history = service.getHistory({ type: 'schedule', id: timed.id })
    const monday = service.getOrGenerateDailyLog('2026-09-21')
    expect(monday.autoItems.map((item) => item.snapshotMarkdown)).toEqual([
      '- Night \\*shift\\* [2026-09-21 23:30, 2026-09-22 00:30)',
      '- Trip [2026-09-21, 2026-09-23)'
    ])
    expect(monday.autoItems.map((item) => item.sourceEntityId)).toEqual([timed.id, allDay.id])
    expect(monday.autoItems.every((item) => item.section === 'planned')).toBe(true)
    expect(service.getOrGenerateDailyLog('2026-09-22').autoItems).toHaveLength(2)
    expect(service.getOrGenerateDailyLog('2026-09-23').autoItems).toEqual([])
    close(service)

    service = open(path, '2026-09-23T03:00:00.000Z')
    service.updateSchedule(command({
      kind: 'timed' as const, id: timed.id, expectedRevision: 1,
      title: 'Later edit', bodyMarkdown: 'Later body',
      startAtUtc: '2026-09-24T03:00:00.000Z', endAtUtc: '2026-09-24T04:00:00.000Z'
    }))
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(monday)
    expect(service.getHistory({ type: 'schedule', id: timed.id })[0]).toEqual(history[0])
    expect(formatDailyLogInstant('2026-09-21T16:00:00.000Z', 'Asia/Shanghai'))
      .toBe('2026-09-22 00:00')
    expect(formatDailyLogInstant('2026-03-08T07:00:00.000Z', 'America/New_York'))
      .toBe('2026-03-08 03:00')
  })

  test('localizes only export scaffolding using persisted appearance without rewriting content', async () => {
    const path = await pathForTest()
    let service = open(path)
    const body = '计划：用户正文（结束日不含）\n\n## 当天安排（计划）\n- [ ] tomorrow'
    const note = service.createNote(command({
      id: randomUUID(), title: '当天笔记 user title', bodyMarkdown: body
    })).value
    service.createSchedule(command({
      kind: 'all-day' as const, id: randomUUID(), title: 'Trip', bodyMarkdown: body,
      startDate: '2026-09-21', endDateExclusive: '2026-09-22'
    }))
    service.saveDailyLogManual(command({
      date: '2026-09-21', expectedRevision: 0, manualMarkdown: body
    }))
    const log = service.getOrGenerateDailyLog('2026-09-21')
    const history = service.getHistory({ type: 'note', id: note.id })
    // Missing settings and the private formatter's one-argument call retain compatibility.
    const chinese = service.renderDailyLogMarkdown('2026-09-21')
    expect(chinese).toBe(dailyLogToMarkdown(log))
    expect(chinese).toContain('时区：Asia/Shanghai')
    expect(chinese).toContain('## 当天完成\n\n（无）')
    expect(chinese).toContain('## 截至日界线仍待办')
    expect(chinese).toContain('## 当天安排（计划）')
    expect(chinese).toContain('## 当天笔记')
    expect(chinese).toContain('## 手写补充')
    service.updateAppearance(command({ locale: 'en-US' as const }))
    close(service)

    service = open(path, '2026-09-22T03:00:00.000Z')
    const english = service.renderDailyLogMarkdown('2026-09-21')
    expect(english).toBe(dailyLogToMarkdown(log, 'en-US'))
    expect(english).toContain('Time zone: Asia/Shanghai')
    expect(english).toContain('## Completed today\n\n(None)')
    expect(english).toContain('## Pending at day boundary')
    expect(english).toContain('## Schedules (planned)')
    expect(english).toContain('- Trip [2026-09-21, 2026-09-22)')
    expect(english).not.toContain('- 计划：Trip')
    expect(english).toContain('## Notes today')
    expect(english).toContain(`## Manual notes\n\n${body}`)
    expect(english).toContain(`### 当天笔记 user title\n\n${body}`)
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(log)
    expect(service.getNote(note.id)).toEqual(note)
    expect(service.getHistory({ type: 'note', id: note.id })).toEqual(history)
    service.updateAppearance(command({ locale: 'zh-CN' as const }))
    expect(service.renderDailyLogMarkdown('2026-09-21')).toBe(chinese)
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(log)
  })

  test('regenerates legacy schedule metadata structurally and keeps source history and item IDs', async () => {
    const path = await pathForTest()
    let service = open(path)
    const schedule = service.createSchedule(command({
      kind: 'all-day' as const, id: randomUUID(), title: '计划：literal title（结束日不含）',
      bodyMarkdown: '计划：literal body（结束日不含）',
      startDate: '2026-09-21', endDateExclusive: '2026-09-22'
    })).value
    const history = service.getHistory({ type: 'schedule', id: schedule.id })
    const log = service.getOrGenerateDailyLog('2026-09-21')
    close(service)
    const db = new DatabaseSync(path)
    try {
      db.prepare('UPDATE daily_log_items SET snapshot_markdown = ? WHERE id = ?')
        .run('- 计划：legacy text（2026-09-21 — 2026-09-22（结束日不含））', log.autoItems[0]!.id)
    } finally {
      db.close()
    }
    service = open(path, '2026-09-22T03:00:00.000Z')
    const regenerated = service.getOrGenerateDailyLog('2026-09-21')
    expect(regenerated.autoItems[0]).toEqual(log.autoItems[0])
    expect(regenerated.autoItems[0]?.snapshotMarkdown)
      .toBe('- 计划：literal title（结束日不含） [2026-09-21, 2026-09-22)')
    expect(service.getHistory({ type: 'schedule', id: schedule.id })).toEqual(history)
    expect(service.getEntity({ type: 'schedule', id: schedule.id })?.value).toEqual(schedule)
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(regenerated)
  })

  test('preserves the complete maximum note title and body across generation and restart', async () => {
    const path = await pathForTest()
    const service = open(path)
    const title = '*'.repeat(500)
    const bodyMarkdown = '文'.repeat(1_000_000)
    const note = service.createNote(command({ id: randomUUID(), title, bodyMarkdown })).value
    const log = service.getOrGenerateDailyLog('2026-09-21')
    const item = log.autoItems[0]!
    const completeMarkdown = `### ${'\\*'.repeat(500)}\n\n${bodyMarkdown}`
    expect(item.snapshotMarkdown).toBe(completeMarkdown)
    expect(service.getNote(note.id)).toEqual(note)
    expect(service.getHistory({ type: 'note', id: note.id })[0]?.snapshot.value).toEqual(note)
    expect(service.getOrGenerateDailyLog('2026-09-21')).toEqual(log)
    expect(completeMarkdown.length).toBe(1_001_006)
    expect(dailyLogItemSchema.safeParse({ ...item, snapshotMarkdown: completeMarkdown }).success)
      .toBe(true)
    close(service)
    const reopened = open(path, '2026-09-22T03:00:00.000Z')
    expect(reopened.getOrGenerateDailyLog('2026-09-21')).toEqual(log)
    expect(reopened.renderDailyLogMarkdown('2026-09-21')).toContain(completeMarkdown)
  })
})
