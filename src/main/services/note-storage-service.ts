import { createHash, randomUUID } from 'node:crypto'
import { IdempotencyConflictError } from '../../domain/storage-errors'
import { nowUtc, type Clock } from '../../shared/clock'
import {
  entityIdSchema,
  ianaTimeZoneSchema,
  noteSchema,
  type Note
} from '../../shared/model'
import {
  changeEventSchema,
  createNoteRequestSchema,
  type ChangeEvent,
  type CreateNoteRequest
} from '../../shared/ipc-contract'
import { QuietDeskDatabase } from '../data/quietdesk-database'

const CREATE_NOTE_OPERATION = 'notes.create.v1'

interface NoteRow {
  id: string
  title: string
  body_markdown: string
  created_at_utc: string
  updated_at_utc: string
  deleted_at_utc: string | null
}

interface ReceiptRow {
  operation: string
  command_fingerprint: string
  result_note_json: string
  result_change_json: string
}

export interface CreateNoteStorageResult {
  note: Note
  change: ChangeEvent
  replayed: boolean
}

function noteFromRow(row: NoteRow): Note {
  return noteSchema.parse({
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    deletedAtUtc: row.deleted_at_utc
  })
}

function commandFingerprint(request: CreateNoteRequest): string {
  const canonicalCommand = JSON.stringify({
    operation: CREATE_NOTE_OPERATION,
    payload: request.payload
  })
  return createHash('sha256').update(canonicalCommand, 'utf8').digest('hex')
}

function parseReceiptResult(row: ReceiptRow): Omit<CreateNoteStorageResult, 'replayed'> {
  return {
    note: noteSchema.parse(JSON.parse(row.result_note_json) as unknown),
    change: changeEventSchema.parse(JSON.parse(row.result_change_json) as unknown)
  }
}

function toSequence(value: number | bigint): number {
  const sequence = Number(value)
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('SQLite returned an invalid change sequence')
  }
  return sequence
}

export { IdempotencyConflictError }

export class NoteStorageService {
  private readonly database: QuietDeskDatabase

  constructor(options: { databasePath: string; clock: Clock }) {
    this.database = new QuietDeskDatabase(options.databasePath)
    this.clock = options.clock
  }

  private readonly clock: Clock

  createNote(request: CreateNoteRequest): CreateNoteStorageResult {
    const validatedRequest = createNoteRequestSchema.parse(request)
    const fingerprint = commandFingerprint(validatedRequest)

    return this.database.transaction(() => {
      const existing = this.database.connection.prepare(`
        SELECT operation, command_fingerprint, result_note_json, result_change_json
        FROM idempotency_receipts
        WHERE idempotency_key = ?
      `).get(validatedRequest.idempotencyKey) as ReceiptRow | undefined

      if (existing) {
        if (
          existing.operation !== CREATE_NOTE_OPERATION ||
          existing.command_fingerprint !== fingerprint
        ) {
          throw new IdempotencyConflictError(validatedRequest.idempotencyKey)
        }
        return { ...parseReceiptResult(existing), replayed: true }
      }

      const occurredAtUtc = nowUtc(this.clock)
      const note = noteSchema.parse({
        id: validatedRequest.payload.id,
        title: validatedRequest.payload.title,
        bodyMarkdown: validatedRequest.payload.bodyMarkdown,
        createdAtUtc: occurredAtUtc,
        updatedAtUtc: occurredAtUtc,
        deletedAtUtc: null
      })

      this.database.connection.prepare(`
        INSERT INTO notes (
          id, title, body_markdown, created_at_utc, updated_at_utc, deleted_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        note.id,
        note.title,
        note.bodyMarkdown,
        note.createdAtUtc,
        note.updatedAtUtc,
        note.deletedAtUtc
      )

      const eventId = randomUUID()
      const changeInsert = this.database.connection.prepare(`
        INSERT INTO change_events (event_id, occurred_at_utc, topics_json, entity_refs_json)
        VALUES (?, ?, ?, ?)
      `).run(
        eventId,
        occurredAtUtc,
        JSON.stringify(['notes']),
        JSON.stringify([{ type: 'note', id: note.id }])
      )

      const change = changeEventSchema.parse({
        eventId,
        sequence: toSequence(changeInsert.lastInsertRowid),
        occurredAtUtc,
        topics: ['notes'],
        entityRefs: [{ type: 'note', id: note.id }]
      })

      this.database.connection.prepare(`
        INSERT INTO idempotency_receipts (
          idempotency_key,
          operation,
          command_fingerprint,
          result_note_id,
          change_sequence,
          result_note_json,
          result_change_json,
          created_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        validatedRequest.idempotencyKey,
        CREATE_NOTE_OPERATION,
        fingerprint,
        note.id,
        change.sequence,
        JSON.stringify(note),
        JSON.stringify(change),
        occurredAtUtc
      )

      return { note, change, replayed: false }
    })
  }

  getNote(id: string): Note | undefined {
    const validatedId = entityIdSchema.parse(id)
    const row = this.database.connection.prepare(`
      SELECT id, title, body_markdown, created_at_utc, updated_at_utc, deleted_at_utc
      FROM notes
      WHERE id = ?
    `).get(validatedId) as NoteRow | undefined

    return row ? noteFromRow(row) : undefined
  }

  getDataRevision(): number {
    const row = this.database.connection.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS revision
      FROM change_events
    `).get() as { revision?: number | bigint } | undefined
    const revision = Number(row?.revision ?? 0)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('SQLite returned an invalid data revision')
    }
    return revision
  }

  getOrCreateAppTimeZone(defaultTimeZone: string): string {
    const validatedDefault = ianaTimeZoneSchema.parse(defaultTimeZone)

    return this.database.transaction(() => {
      const existing = this.database.connection.prepare(`
        SELECT value
        FROM app_settings
        WHERE key = ?
      `).get('app.timeZone') as { value?: string } | undefined

      if (existing?.value !== undefined) {
        return ianaTimeZoneSchema.parse(existing.value)
      }

      this.database.connection.prepare(`
        INSERT INTO app_settings (key, value, updated_at_utc)
        VALUES (?, ?, ?)
      `).run('app.timeZone', validatedDefault, nowUtc(this.clock))

      return validatedDefault
    })
  }

  close(): void {
    this.database.close()
  }
}
