import { mkdirSync } from 'node:fs'
import { isAbsolute, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const BUSY_TIMEOUT_MS = 5_000

const MIGRATIONS = [
  `
    CREATE TABLE notes (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(title) <= 500),
      body_markdown TEXT NOT NULL CHECK (length(body_markdown) <= 1000000),
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      deleted_at_utc TEXT
    ) STRICT;

    CREATE TABLE change_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      occurred_at_utc TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      entity_refs_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE idempotency_receipts (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      operation TEXT NOT NULL,
      command_fingerprint TEXT NOT NULL,
      result_note_id TEXT NOT NULL,
      change_sequence INTEGER NOT NULL,
      result_note_json TEXT NOT NULL,
      result_change_json TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (result_note_id) REFERENCES notes(id) ON DELETE RESTRICT,
      FOREIGN KEY (change_sequence) REFERENCES change_events(sequence) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL
    ) STRICT;
  `,
  `
    ALTER TABLE notes
      ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

    ALTER TABLE idempotency_receipts RENAME TO idempotency_receipts_v1;

    CREATE TABLE idempotency_receipts (
      idempotency_key TEXT PRIMARY KEY NOT NULL,
      operation TEXT NOT NULL,
      command_fingerprint TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      result_json TEXT,
      result_change_json TEXT NOT NULL,
      change_sequence INTEGER NOT NULL,
      redacted_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      FOREIGN KEY (change_sequence) REFERENCES change_events(sequence) ON DELETE RESTRICT
    ) STRICT;

    INSERT INTO idempotency_receipts (
      idempotency_key,
      operation,
      command_fingerprint,
      subject_type,
      subject_id,
      result_json,
      result_change_json,
      change_sequence,
      redacted_at_utc,
      created_at_utc
    )
    SELECT
      idempotency_key,
      operation,
      command_fingerprint,
      'note',
      result_note_id,
      result_note_json,
      result_change_json,
      change_sequence,
      NULL,
      created_at_utc
    FROM idempotency_receipts_v1;

    DROP TABLE idempotency_receipts_v1;

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 500),
      body_markdown TEXT NOT NULL CHECK (length(body_markdown) <= 1000000),
      plan_date TEXT,
      due_date TEXT,
      completed_at_utc TEXT,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      deleted_at_utc TEXT
    ) STRICT;

    CREATE TABLE schedules (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('timed', 'all-day')),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 500),
      body_markdown TEXT NOT NULL CHECK (length(body_markdown) <= 1000000),
      start_at_utc TEXT,
      end_at_utc TEXT,
      start_date TEXT,
      end_date_exclusive TEXT,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      deleted_at_utc TEXT,
      CHECK (
        (kind = 'timed'
          AND start_at_utc IS NOT NULL
          AND end_at_utc IS NOT NULL
          AND start_at_utc < end_at_utc
          AND start_date IS NULL
          AND end_date_exclusive IS NULL)
        OR
        (kind = 'all-day'
          AND start_at_utc IS NULL
          AND end_at_utc IS NULL
          AND start_date IS NOT NULL
          AND end_date_exclusive IS NOT NULL
          AND start_date < end_date_exclusive)
      )
    ) STRICT;

    CREATE TABLE drafts (
      id TEXT PRIMARY KEY NOT NULL,
      capture_kind TEXT NOT NULL CHECK (capture_kind IN ('note', 'task', 'schedule')),
      payload_json TEXT NOT NULL CHECK (length(payload_json) <= 1000000),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      saved_at_utc TEXT NOT NULL
    ) STRICT;

    CREATE TABLE operation_history (
      operation_id TEXT PRIMARY KEY NOT NULL,
      sequence INTEGER NOT NULL UNIQUE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'note', 'schedule')),
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      attribution_date TEXT NOT NULL,
      attribution_time_zone TEXT NOT NULL,
      entity_revision INTEGER NOT NULL CHECK (entity_revision >= 1),
      snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) <= 2000000),
      FOREIGN KEY (sequence) REFERENCES change_events(sequence) ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX idx_tasks_current
      ON tasks(plan_date, due_date, created_at_utc, id)
      WHERE deleted_at_utc IS NULL AND completed_at_utc IS NULL;
    CREATE INDEX idx_tasks_completed
      ON tasks(completed_at_utc, id)
      WHERE deleted_at_utc IS NULL AND completed_at_utc IS NOT NULL;
    CREATE INDEX idx_tasks_deleted
      ON tasks(deleted_at_utc, id)
      WHERE deleted_at_utc IS NOT NULL;
    CREATE INDEX idx_notes_active
      ON notes(updated_at_utc, id)
      WHERE deleted_at_utc IS NULL;
    CREATE INDEX idx_notes_deleted
      ON notes(deleted_at_utc, id)
      WHERE deleted_at_utc IS NOT NULL;
    CREATE INDEX idx_schedules_timed
      ON schedules(start_at_utc, end_at_utc, id)
      WHERE kind = 'timed' AND deleted_at_utc IS NULL;
    CREATE INDEX idx_schedules_all_day
      ON schedules(start_date, end_date_exclusive, id)
      WHERE kind = 'all-day' AND deleted_at_utc IS NULL;
    CREATE INDEX idx_schedules_deleted
      ON schedules(deleted_at_utc, id)
      WHERE deleted_at_utc IS NOT NULL;
    CREATE INDEX idx_history_entity
      ON operation_history(entity_type, entity_id, sequence);
    CREATE INDEX idx_history_date
      ON operation_history(attribution_date, sequence);
    CREATE INDEX idx_receipts_subject
      ON idempotency_receipts(subject_type, subject_id);
  `
] as const

function readUserVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined
  const version = Number(row?.user_version)
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('SQLite returned an invalid user_version')
  }
  return version
}

function applyMigrations(database: DatabaseSync): void {
  let currentVersion = readUserVersion(database)
  if (currentVersion > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than supported version ${MIGRATIONS.length}`
    )
  }

  while (currentVersion < MIGRATIONS.length) {
    const nextVersion = currentVersion + 1
    const migration = MIGRATIONS[currentVersion]
    if (!migration) {
      throw new Error(`Missing SQLite migration ${nextVersion}`)
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration)
      database.exec(`PRAGMA user_version = ${nextVersion}`)
      database.exec('COMMIT')
      currentVersion = nextVersion
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

export class QuietDeskDatabase {
  readonly connection: DatabaseSync
  private closed = false

  constructor(readonly databasePath: string) {
    if (!databasePath || !isAbsolute(databasePath)) {
      throw new Error('QuietDesk SQLite databasePath must be an explicit absolute path')
    }

    mkdirSync(dirname(databasePath), { recursive: true })
    this.connection = new DatabaseSync(databasePath)

    try {
      this.connection.exec('PRAGMA foreign_keys = ON')
      this.connection.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
      applyMigrations(this.connection)
    } catch (error) {
      this.connection.close()
      this.closed = true
      throw error
    }
  }

  transaction<T>(work: () => T): T {
    this.assertOpen()
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    if (this.closed) return
    this.connection.close()
    this.closed = true
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('QuietDesk SQLite database is closed')
    }
  }
}
