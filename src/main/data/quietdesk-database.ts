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
