import type { Clock } from '../../shared/clock'
import type { Note } from '../../shared/model'
import type { ChangeEvent, CreateNoteRequest } from '../../shared/ipc-contract'
import {
  CoreDataService,
  IdempotencyConflictError
} from './core-data-service'

export interface CreateNoteStorageResult {
  note: Note
  change: ChangeEvent
  replayed: boolean
}

/**
 * Compatibility facade for the stage 2 storage smoke. Product code should own one
 * CoreDataService instance and must not open this facade beside it.
 */
export class NoteStorageService {
  private readonly core: CoreDataService

  constructor(options: { databasePath: string; clock: Clock }) {
    this.core = new CoreDataService(options)
  }

  createNote(request: CreateNoteRequest): CreateNoteStorageResult {
    const result = this.core.createNote(request)
    return {
      note: result.value,
      change: result.change,
      replayed: result.replayed
    }
  }

  getNote(id: string): Note | undefined {
    return this.core.getNote(id)
  }

  getDataRevision(): number {
    return this.core.getDataRevision()
  }

  getOrCreateAppTimeZone(defaultTimeZone: string): string {
    return this.core.getOrCreateAppTimeZone(defaultTimeZone)
  }

  close(): void {
    this.core.close()
  }
}

export { IdempotencyConflictError }
