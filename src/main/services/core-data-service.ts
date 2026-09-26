import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  EntityNotFoundError,
  IdempotencyConflictError,
  StorageConflictError
} from '../../domain/storage-errors'
import {
  dateForInstantInTimeZone,
  nextDate,
  utcDayBounds
} from '../../domain/time-zone-day'
import { dailyLogToMarkdown, formatDailyLogInstant } from '../../domain/daily-log-markdown'
import { nowUtc, type Clock } from '../../shared/clock'
import {
  draftSchema,
  dailyLogSchema,
  dailyLogItemSchema,
  dateOnlySchema,
  entityIdSchema,
  entityRecordSchema,
  ianaTimeZoneSchema,
  noteSchema,
  operationSnapshotSchema,
  permanentDeleteReceiptSchema,
  scheduleSchema,
  taskSchema,
  trashEntrySchema,
  type DateOnly,
  type DailyLog,
  type DailyLogItem,
  type Draft,
  type EntityRecord,
  type EntityType,
  type Note,
  type OperationKind,
  type OperationSnapshot,
  type PermanentDeleteReceipt,
  type Schedule,
  type Task,
  type TrashEntry
} from '../../shared/model'
import {
  appearanceSettingsSchema,
  changeEventSchema,
  createNoteRequestSchema,
  createScheduleRequestSchema,
  createTaskRequestSchema,
  dayViewSnapshotSchema,
  entityMutationRequestSchema,
  entityReferenceSchema,
  localeSchema,
  permanentlyDeleteEntityRequestSchema,
  rescheduleTaskRequestSchema,
  saveDailyLogManualRequestSchema,
  saveDraftRequestSchema,
  setTaskCompletionRequestSchema,
  shortcutAcceleratorSchema,
  submitDraftReceiptSchema,
  submitDraftRequestSchema,
  updateAppearanceRequestSchema,
  updateShortcutRequestSchema,
  updateNoteRequestSchema,
  updateScheduleRequestSchema,
  updateTaskRequestSchema,
  widgetSnapshotSchema,
  type AppearanceSettings,
  type ChangeEvent,
  type CreateNoteRequest,
  type CreateScheduleRequest,
  type CreateTaskRequest,
  type DayViewSnapshot,
  type EntityMutationRequest,
  type PermanentlyDeleteEntityRequest,
  type RescheduleTaskRequest,
  type SaveDailyLogManualRequest,
  type SaveDraftRequest,
  type SetTaskCompletionRequest,
  type SubmitDraftReceipt,
  type SubmitDraftRequest,
  type UpdateAppearanceRequest,
  type UpdateNoteRequest,
  type UpdateScheduleRequest,
  type UpdateShortcutRequest,
  type UpdateTaskRequest,
  type WidgetSnapshot
} from '../../shared/ipc-contract'
import { QuietDeskDatabase } from '../data/quietdesk-database'

const WIDGET_TASK_LIMIT = 6
const WIDGET_SCHEDULE_LIMIT = 5
const WIDGET_NOTE_LIMIT = 3
const WIDGET_COMPLETED_LIMIT = 5
const CAPTURE_SHORTCUT_SETTING_KEY = 'capture.shortcut'
const captureShortcutSettingSchema = z.object({
  accelerator: shortcutAcceleratorSchema
}).strict()

type EntityReference = { type: EntityType; id: string }
type ChangeTopic = ChangeEvent['topics'][number]
type ChangeEntityReference = ChangeEvent['entityRefs'][number]

interface TaskRow {
  id: string
  title: string
  body_markdown: string
  plan_date: string | null
  due_date: string | null
  completed_at_utc: string | null
  revision: number | bigint
  created_at_utc: string
  updated_at_utc: string
  deleted_at_utc: string | null
}

interface NoteRow {
  id: string
  title: string
  body_markdown: string
  revision: number | bigint
  created_at_utc: string
  updated_at_utc: string
  deleted_at_utc: string | null
}

interface ScheduleRow {
  id: string
  kind: 'timed' | 'all-day'
  title: string
  body_markdown: string
  start_at_utc: string | null
  end_at_utc: string | null
  start_date: string | null
  end_date_exclusive: string | null
  revision: number | bigint
  created_at_utc: string
  updated_at_utc: string
  deleted_at_utc: string | null
}

interface DraftRow {
  id: string
  capture_kind: Draft['captureKind']
  payload_json: string
  revision: number | bigint
  created_at_utc: string
  updated_at_utc: string
  saved_at_utc: string
}

interface ReceiptRow {
  operation: string
  command_fingerprint: string
  subject_type: string | null
  subject_id: string | null
  result_json: string | null
  result_change_json: string
  redacted_at_utc: string | null
}

interface HistoryRow {
  operation_id: string
  sequence: number | bigint
  entity_type: EntityType
  entity_id: string
  operation: OperationKind
  occurred_at_utc: string
  attribution_date: string
  attribution_time_zone: string
  entity_revision: number | bigint
  snapshot_json: string
}

interface DailyLogRow {
  id: string
  log_date: string
  attribution_time_zone: string
  generated_at_utc: string
  generation_version: number | bigint
  manual_markdown: string
  manual_revision: number | bigint
  created_at_utc: string
  updated_at_utc: string
}

interface DailyLogItemRow {
  id: string
  section: DailyLogItem['section']
  source_entity_type: EntityType
  source_entity_id: string
  source_operation_id: string | null
  stable_order: number | bigint
  snapshot_markdown: string
}

export interface MutationResult<T> {
  value: T
  change: ChangeEvent
  replayed: boolean
}

interface MutationOptions<T> {
  operation: string
  idempotencyKey: string
  payload: unknown
  subjectType: string | null
  subjectId: string | null
  topics: ChangeTopic[]
  entityRefs: ChangeEntityReference[]
  parseValue(value: unknown): T
  perform(occurredAtUtc: string): T
  afterChange?(value: T, change: ChangeEvent, occurredAtUtc: string): void
}

function integer(value: number | bigint, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(`SQLite returned an invalid ${label}`)
  return result
}

function taskFromRow(row: TaskRow): Task {
  return taskSchema.parse({
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    planDate: row.plan_date,
    dueDate: row.due_date,
    completedAtUtc: row.completed_at_utc,
    revision: integer(row.revision, 'Task revision'),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    deletedAtUtc: row.deleted_at_utc
  })
}

function noteFromRow(row: NoteRow): Note {
  return noteSchema.parse({
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    revision: integer(row.revision, 'Note revision'),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    deletedAtUtc: row.deleted_at_utc
  })
}

function scheduleFromRow(row: ScheduleRow): Schedule {
  const base = {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    revision: integer(row.revision, 'Schedule revision'),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    deletedAtUtc: row.deleted_at_utc
  }
  return scheduleSchema.parse(row.kind === 'timed'
    ? { ...base, kind: 'timed', startAtUtc: row.start_at_utc, endAtUtc: row.end_at_utc }
    : { ...base, kind: 'all-day', startDate: row.start_date, endDateExclusive: row.end_date_exclusive })
}

function draftFromRow(row: DraftRow): Draft {
  return draftSchema.parse({
    id: row.id,
    captureKind: row.capture_kind,
    payload: JSON.parse(row.payload_json) as unknown,
    revision: integer(row.revision, 'Draft revision'),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    savedAtUtc: row.saved_at_utc
  })
}

function fingerprint(operation: string, payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation, payload }), 'utf8')
    .digest('hex')
}

function plainTextPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_>#~-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 280)
}

function systemTimeZone(): string {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const parsed = ianaTimeZoneSchema.safeParse(candidate)
  return parsed.success ? parsed.data : 'UTC'
}

export class CoreDataService {
  private readonly database: QuietDeskDatabase
  private readonly clock: Clock

  constructor(options: { databasePath: string; clock: Clock }) {
    this.database = new QuietDeskDatabase(options.databasePath)
    this.clock = options.clock
    this.backfillLegacyNoteHistory()
  }

  createTask(request: CreateTaskRequest): MutationResult<Task> {
    const validated = createTaskRequestSchema.parse(request)
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation: 'tasks.create.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'task',
      subjectId: validated.payload.id,
      topics: ['tasks'],
      entityRefs: [{ type: 'task', id: validated.payload.id }],
      parseValue: (value) => taskSchema.parse(value),
      perform: (occurredAtUtc) => {
        const task = taskSchema.parse({
          ...validated.payload,
          revision: 1,
          completedAtUtc: null,
          createdAtUtc: occurredAtUtc,
          updatedAtUtc: occurredAtUtc,
          deletedAtUtc: null
        })
        this.database.connection.prepare(`
          INSERT INTO tasks (
            id, title, body_markdown, plan_date, due_date, completed_at_utc,
            revision, created_at_utc, updated_at_utc, deleted_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          task.id, task.title, task.bodyMarkdown, task.planDate, task.dueDate,
          task.completedAtUtc, task.revision, task.createdAtUtc, task.updatedAtUtc,
          task.deletedAtUtc
        )
        return task
      },
      afterChange: (task, change, occurredAtUtc) => {
        this.recordHistory({ type: 'task', value: task }, 'task.created', change, occurredAtUtc, timeZone)
      }
    })
  }

  updateTask(request: UpdateTaskRequest): MutationResult<Task> {
    const validated = updateTaskRequestSchema.parse(request)
    return this.mutateTask(
      'tasks.update.v2',
      validated.idempotencyKey,
      validated.payload,
      'task.updated',
      (current, occurredAtUtc) => taskSchema.parse({
        ...current,
        title: validated.payload.title,
        bodyMarkdown: validated.payload.bodyMarkdown,
        planDate: validated.payload.planDate,
        dueDate: validated.payload.dueDate,
        revision: current.revision + 1,
        updatedAtUtc: occurredAtUtc
      })
    )
  }

  setTaskCompletion(request: SetTaskCompletionRequest): MutationResult<Task> {
    const validated = setTaskCompletionRequestSchema.parse(request)
    const operation = validated.payload.action === 'complete'
      ? 'tasks.complete.v2'
      : 'tasks.reopen.v2'
    const historyOperation: OperationKind = validated.payload.action === 'complete'
      ? 'task.completed'
      : 'task.reopened'
    return this.mutateTask(
      operation,
      validated.idempotencyKey,
      validated.payload,
      historyOperation,
      (current, occurredAtUtc) => {
        if (validated.payload.action === 'complete' && current.completedAtUtc !== null) {
          throw new StorageConflictError('already-completed', 'Task is already completed')
        }
        if (validated.payload.action === 'reopen' && current.completedAtUtc === null) {
          throw new StorageConflictError('already-open', 'Task is already open')
        }
        return taskSchema.parse({
          ...current,
          completedAtUtc: validated.payload.action === 'complete' ? occurredAtUtc : null,
          revision: current.revision + 1,
          updatedAtUtc: occurredAtUtc
        })
      }
    )
  }

  rescheduleTask(request: RescheduleTaskRequest): MutationResult<Task> {
    const validated = rescheduleTaskRequestSchema.parse(request)
    return this.mutateTask(
      'tasks.reschedule.v2',
      validated.idempotencyKey,
      validated.payload,
      'task.rescheduled',
      (current, occurredAtUtc) => taskSchema.parse({
        ...current,
        planDate: validated.payload.planDate,
        dueDate: validated.payload.dueDate,
        revision: current.revision + 1,
        updatedAtUtc: occurredAtUtc
      })
    )
  }

  createNote(request: CreateNoteRequest): MutationResult<Note> {
    const validated = createNoteRequestSchema.parse(request)
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation: 'notes.create.v1',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'note',
      subjectId: validated.payload.id,
      topics: ['notes'],
      entityRefs: [{ type: 'note', id: validated.payload.id }],
      parseValue: (value) => noteSchema.parse(value),
      perform: (occurredAtUtc) => {
        const note = noteSchema.parse({
          ...validated.payload,
          revision: 1,
          createdAtUtc: occurredAtUtc,
          updatedAtUtc: occurredAtUtc,
          deletedAtUtc: null
        })
        this.database.connection.prepare(`
          INSERT INTO notes (
            id, title, body_markdown, revision, created_at_utc, updated_at_utc, deleted_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          note.id, note.title, note.bodyMarkdown, note.revision,
          note.createdAtUtc, note.updatedAtUtc, note.deletedAtUtc
        )
        return note
      },
      afterChange: (note, change, occurredAtUtc) => {
        this.recordHistory({ type: 'note', value: note }, 'note.created', change, occurredAtUtc, timeZone)
      }
    })
  }

  getNote(id: string): Note | undefined {
    return this.readNote(entityIdSchema.parse(id))
  }

  updateNote(request: UpdateNoteRequest): MutationResult<Note> {
    const validated = updateNoteRequestSchema.parse(request)
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation: 'notes.update.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'note',
      subjectId: validated.payload.id,
      topics: ['notes'],
      entityRefs: [{ type: 'note', id: validated.payload.id }],
      parseValue: (value) => noteSchema.parse(value),
      perform: (occurredAtUtc) => {
        const current = this.requireActiveEntity({ type: 'note', id: validated.payload.id })
        if (current.type !== 'note') throw new Error('Unexpected entity type')
        this.assertRevision(current.value.revision, validated.payload.expectedRevision)
        const note = noteSchema.parse({
          ...current.value,
          title: validated.payload.title,
          bodyMarkdown: validated.payload.bodyMarkdown,
          revision: current.value.revision + 1,
          updatedAtUtc: occurredAtUtc
        })
        this.database.connection.prepare(`
          UPDATE notes
          SET title = ?, body_markdown = ?, revision = ?, updated_at_utc = ?
          WHERE id = ?
        `).run(note.title, note.bodyMarkdown, note.revision, note.updatedAtUtc, note.id)
        return note
      },
      afterChange: (note, change, occurredAtUtc) => {
        this.recordHistory({ type: 'note', value: note }, 'note.updated', change, occurredAtUtc, timeZone)
      }
    })
  }

  createSchedule(request: CreateScheduleRequest): MutationResult<Schedule> {
    const validated = createScheduleRequestSchema.parse(request)
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation: 'schedules.create.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'schedule',
      subjectId: validated.payload.id,
      topics: ['schedules'],
      entityRefs: [{ type: 'schedule', id: validated.payload.id }],
      parseValue: (value) => scheduleSchema.parse(value),
      perform: (occurredAtUtc) => {
        const schedule = scheduleSchema.parse({
          ...validated.payload,
          revision: 1,
          createdAtUtc: occurredAtUtc,
          updatedAtUtc: occurredAtUtc,
          deletedAtUtc: null
        })
        this.insertSchedule(schedule)
        return schedule
      },
      afterChange: (schedule, change, occurredAtUtc) => {
        this.recordHistory(
          { type: 'schedule', value: schedule },
          'schedule.created',
          change,
          occurredAtUtc,
          timeZone
        )
      }
    })
  }

  updateSchedule(request: UpdateScheduleRequest): MutationResult<Schedule> {
    const validated = updateScheduleRequestSchema.parse(request)
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation: 'schedules.update.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'schedule',
      subjectId: validated.payload.id,
      topics: ['schedules'],
      entityRefs: [{ type: 'schedule', id: validated.payload.id }],
      parseValue: (value) => scheduleSchema.parse(value),
      perform: (occurredAtUtc) => {
        const current = this.requireActiveEntity({ type: 'schedule', id: validated.payload.id })
        if (current.type !== 'schedule') throw new Error('Unexpected entity type')
        this.assertRevision(current.value.revision, validated.payload.expectedRevision)
        const { expectedRevision: _expectedRevision, ...schedulePayload } = validated.payload
        const schedule = scheduleSchema.parse({
          ...schedulePayload,
          revision: current.value.revision + 1,
          createdAtUtc: current.value.createdAtUtc,
          updatedAtUtc: occurredAtUtc,
          deletedAtUtc: null
        })
        this.updateScheduleRow(schedule)
        return schedule
      },
      afterChange: (schedule, change, occurredAtUtc) => {
        this.recordHistory(
          { type: 'schedule', value: schedule },
          'schedule.updated',
          change,
          occurredAtUtc,
          timeZone
        )
      }
    })
  }

  getWidgetSnapshot(): WidgetSnapshot {
    const appTimeZone = this.currentTimeZone()
    const forDate = dateForInstantInTimeZone(this.clock.now(), appTimeZone)
    const currentTasks = this.listCurrentTasks(forDate)
    const schedules = this.listSchedulesForDate(forDate, appTimeZone)
    const recentNotes = this.listRecentNotes()
    const completedToday = this.listCompletedTasksForDate(forDate, appTimeZone)

    return widgetSnapshotSchema.parse({
      dataRevision: this.getDataRevision(),
      forDate,
      appTimeZone,
      currentTasks: currentTasks.slice(0, WIDGET_TASK_LIMIT).map((task) => ({
        task,
        isOverdue: task.dueDate !== null && task.dueDate < forDate
      })),
      todaySchedules: schedules.slice(0, WIDGET_SCHEDULE_LIMIT),
      recentNotes: recentNotes.slice(0, WIDGET_NOTE_LIMIT).map((note) => ({
        note,
        plainTextPreview: plainTextPreview(note.bodyMarkdown)
      })),
      completedToday: completedToday.slice(0, WIDGET_COMPLETED_LIMIT),
      totals: {
        currentTasks: currentTasks.length,
        todaySchedules: schedules.length,
        recentNotes: recentNotes.length,
        completedToday: completedToday.length
      }
    })
  }

  getDayView(date: DateOnly): DayViewSnapshot {
    const appTimeZone = this.currentTimeZone()
    const bounds = utcDayBounds(date, appTimeZone)
    const rows = this.database.connection.prepare(`
      SELECT * FROM tasks
      WHERE deleted_at_utc IS NULL
        AND (
          plan_date = ?
          OR due_date = ?
          OR (completed_at_utc >= ? AND completed_at_utc < ?)
        )
      ORDER BY created_at_utc, id
    `).all(date, date, bounds.startAtUtc, bounds.endAtUtc) as unknown as TaskRow[]

    const notes = this.database.connection.prepare(`
      SELECT * FROM notes
      WHERE deleted_at_utc IS NULL
        AND created_at_utc >= ? AND created_at_utc < ?
      ORDER BY created_at_utc, id
    `).all(bounds.startAtUtc, bounds.endAtUtc) as unknown as NoteRow[]

    return dayViewSnapshotSchema.parse({
      dataRevision: this.getDataRevision(),
      selectedDate: date,
      appTimeZone,
      tasks: rows.map(taskFromRow).map((task) => ({
        task,
        matchReasons: [
          ...(task.planDate === date ? ['planned' as const] : []),
          ...(task.dueDate === date ? ['due' as const] : []),
          ...(task.completedAtUtc !== null &&
            task.completedAtUtc >= bounds.startAtUtc &&
            task.completedAtUtc < bounds.endAtUtc ? ['completed' as const] : [])
        ]
      })),
      schedules: this.listSchedulesForDate(date, appTimeZone),
      notes: notes.map(noteFromRow).map((note) => ({
        note,
        plainTextPreview: plainTextPreview(note.bodyMarkdown)
      }))
    })
  }

  getEntity(reference: EntityReference): EntityRecord | undefined {
    const validated = entityReferenceSchema.parse(reference)
    if (validated.type === 'task') {
      const value = this.readTask(validated.id)
      return value ? { type: 'task', value } : undefined
    }
    if (validated.type === 'note') {
      const value = this.readNote(validated.id)
      return value ? { type: 'note', value } : undefined
    }
    const value = this.readSchedule(validated.id)
    return value ? { type: 'schedule', value } : undefined
  }

  getHistory(reference: EntityReference): OperationSnapshot[] {
    const validated = entityReferenceSchema.parse(reference)
    const rows = this.database.connection.prepare(`
      SELECT * FROM operation_history
      WHERE entity_type = ? AND entity_id = ?
      ORDER BY sequence
    `).all(validated.type, validated.id) as unknown as HistoryRow[]
    return rows.map((row) => operationSnapshotSchema.parse({
      operationId: row.operation_id,
      sequence: integer(row.sequence, 'history sequence'),
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      occurredAtUtc: row.occurred_at_utc,
      attributionDate: row.attribution_date,
      attributionTimeZone: row.attribution_time_zone,
      entityRevision: integer(row.entity_revision, 'history entity revision'),
      snapshot: JSON.parse(row.snapshot_json) as unknown
    }))
  }

  listTrash(): TrashEntry[] {
    const entries: TrashEntry[] = []
    const taskRows = this.database.connection.prepare(`
      SELECT * FROM tasks WHERE deleted_at_utc IS NOT NULL
    `).all() as unknown as TaskRow[]
    const noteRows = this.database.connection.prepare(`
      SELECT * FROM notes WHERE deleted_at_utc IS NOT NULL
    `).all() as unknown as NoteRow[]
    const scheduleRows = this.database.connection.prepare(`
      SELECT * FROM schedules WHERE deleted_at_utc IS NOT NULL
    `).all() as unknown as ScheduleRow[]

    for (const task of taskRows.map(taskFromRow)) {
      entries.push(trashEntrySchema.parse({
        entity: { type: 'task', value: task },
        deletedAtUtc: task.deletedAtUtc
      }))
    }
    for (const note of noteRows.map(noteFromRow)) {
      entries.push(trashEntrySchema.parse({
        entity: { type: 'note', value: note },
        deletedAtUtc: note.deletedAtUtc
      }))
    }
    for (const schedule of scheduleRows.map(scheduleFromRow)) {
      entries.push(trashEntrySchema.parse({
        entity: { type: 'schedule', value: schedule },
        deletedAtUtc: schedule.deletedAtUtc
      }))
    }
    return entries.sort((left, right) =>
      right.deletedAtUtc.localeCompare(left.deletedAtUtc) ||
      left.entity.value.id.localeCompare(right.entity.value.id)
    )
  }

  getOrGenerateDailyLog(date: DateOnly): DailyLog {
    const validatedDate = dateOnlySchema.parse(date)
    this.currentTimeZone()
    return this.database.transaction(() => this.generateDailyLog(validatedDate))
  }

  saveDailyLogManual(request: SaveDailyLogManualRequest): MutationResult<DailyLog> {
    const validated = saveDailyLogManualRequestSchema.parse(request)
    this.currentTimeZone()
    const operation = 'daily-logs.save-manual.v4'
    const commandFingerprint = fingerprint(operation, validated.payload)
    return this.database.transaction(() => {
      const replay = this.readReceipt(
        validated.idempotencyKey,
        operation,
        commandFingerprint,
        (value) => dailyLogSchema.parse(value)
      )
      if (replay) {
        return {
          ...replay,
          value: {
            ...replay.value,
            autoItems: replay.value.autoItems.filter((item) =>
              this.getEntity({ type: item.sourceEntityType, id: item.sourceEntityId })
                ?.value.deletedAtUtc === null
            )
          }
        }
      }

      const current = this.generateDailyLog(validated.payload.date)
      if (current.manualRevision !== validated.payload.expectedRevision) {
        throw new StorageConflictError('revision-mismatch', 'Daily Log manual revision does not match')
      }
      const occurredAtUtc = nowUtc(this.clock)
      this.database.connection.prepare(`
        UPDATE daily_logs
        SET manual_markdown = ?, manual_revision = ?, updated_at_utc = ?
        WHERE log_date = ?
      `).run(
        validated.payload.manualMarkdown,
        current.manualRevision + 1,
        occurredAtUtc,
        current.logDate
      )
      const value = this.readDailyLog(current.logDate)!
      const change = this.insertChange(
        occurredAtUtc,
        ['daily-logs'],
        [{ type: 'daily-log', id: value.id }]
      )
      this.writeReceipt({
        idempotencyKey: validated.idempotencyKey,
        operation,
        commandFingerprint,
        subjectType: 'daily-log',
        subjectId: value.id,
        value,
        change,
        occurredAtUtc
      })
      return { value, change, replayed: false }
    })
  }

  renderDailyLogMarkdown(date: DateOnly): string {
    const locale = localeSchema.parse(this.readSetting('appearance.locale') ?? 'zh-CN')
    return dailyLogToMarkdown(this.getOrGenerateDailyLog(date), locale)
  }

  reconcileActiveDailyLogs(): number {
    const timeZone = this.currentTimeZone()
    const today = dateForInstantInTimeZone(this.clock.now(), timeZone)
    const previous = this.readSetting('daily-log.last-reconciled-date')
    const firstHistory = this.database.connection.prepare(`
      SELECT MIN(date_value) AS first_date FROM (
        SELECT attribution_date AS date_value FROM operation_history
        UNION ALL SELECT log_date AS date_value FROM daily_logs
      )
    `).get() as { first_date: string | null }
    let date = dateOnlySchema.parse(previous ?? firstHistory.first_date ?? today)
    let retained = 0
    while (date <= today) {
      const target = date
      this.database.transaction(() => {
        const existed = this.readDailyLog(target) !== undefined
        const log = this.generateDailyLog(target)
        if (!existed && log.autoItems.length === 0 && log.manualMarkdown === '') {
          this.database.connection.prepare('DELETE FROM daily_logs WHERE log_date = ?').run(target)
        } else {
          retained += 1
        }
        this.writeSetting('daily-log.last-reconciled-date', target, nowUtc(this.clock))
      })
      if (date === today) break
      date = nextDate(date)
    }
    return retained
  }

  getDraft(id: string): Draft | undefined {
    const validatedId = entityIdSchema.parse(id)
    const row = this.database.connection.prepare(`
      SELECT * FROM drafts WHERE id = ?
    `).get(validatedId) as unknown as DraftRow | undefined
    return row ? draftFromRow(row) : undefined
  }

  saveDraft(request: SaveDraftRequest): MutationResult<Draft> {
    const validated = saveDraftRequestSchema.parse(request)
    return this.mutate({
      operation: 'drafts.save.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'draft',
      subjectId: validated.payload.id,
      topics: ['drafts'],
      entityRefs: [{ type: 'draft', id: validated.payload.id }],
      parseValue: (value) => draftSchema.parse(value),
      perform: (occurredAtUtc) => {
        const current = this.getDraft(validated.payload.id)
        if (!current && validated.payload.expectedRevision !== 0) {
          throw new StorageConflictError('draft-revision', 'Draft does not exist at the expected revision')
        }
        if (current && current.revision !== validated.payload.expectedRevision) {
          throw new StorageConflictError('draft-revision', 'Draft revision does not match')
        }
        const draft = draftSchema.parse({
          id: validated.payload.id,
          captureKind: validated.payload.captureKind,
          payload: validated.payload.payload,
          revision: validated.payload.expectedRevision + 1,
          createdAtUtc: current?.createdAtUtc ?? occurredAtUtc,
          updatedAtUtc: occurredAtUtc,
          savedAtUtc: occurredAtUtc
        })
        this.database.connection.prepare(`
          INSERT INTO drafts (
            id, capture_kind, payload_json, revision, created_at_utc, updated_at_utc, saved_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            capture_kind = excluded.capture_kind,
            payload_json = excluded.payload_json,
            revision = excluded.revision,
            updated_at_utc = excluded.updated_at_utc,
            saved_at_utc = excluded.saved_at_utc
        `).run(
          draft.id, draft.captureKind, JSON.stringify(draft.payload), draft.revision,
          draft.createdAtUtc, draft.updatedAtUtc, draft.savedAtUtc
        )
        return draft
      }
    })
  }

  submitDraft(request: SubmitDraftRequest): MutationResult<SubmitDraftReceipt> {
    const validated = submitDraftRequestSchema.parse(request)
    const operation = 'drafts.submit.v3'
    const commandFingerprint = fingerprint(operation, validated.payload)
    const timeZone = this.currentTimeZone()

    return this.database.transaction(() => {
      const replay = this.readReceipt(
        validated.idempotencyKey,
        operation,
        commandFingerprint,
        (value) => submitDraftReceiptSchema.parse(value)
      )
      if (replay) return replay

      const draft = this.getDraft(validated.payload.draftId)
      if (!draft) {
        throw new EntityNotFoundError('draft', validated.payload.draftId)
      }
      this.assertRevision(draft.revision, validated.payload.expectedRevision)

      const occurredAtUtc = nowUtc(this.clock)
      const entity = this.createEntityFromDraft(draft, validated.payload.entityId, occurredAtUtc)
      const entityReference = { type: entity.type, id: entity.value.id }
      const change = this.insertChange(
        occurredAtUtc,
        [this.topicForEntity(entity.type), 'drafts'],
        [entityReference, { type: 'draft', id: draft.id }]
      )
      this.recordHistory(
        entity,
        this.createdOperationForEntity(entity.type),
        change,
        occurredAtUtc,
        timeZone
      )

      const deleted = this.database.connection.prepare(`
        DELETE FROM drafts WHERE id = ? AND revision = ?
      `).run(draft.id, draft.revision)
      if (deleted.changes !== 1) {
        throw new StorageConflictError('draft-revision', 'Draft revision changed before submission')
      }

      const receipt = submitDraftReceiptSchema.parse({
        entity,
        submittedDraftRevision: draft.revision
      })
      this.writeReceipt({
        idempotencyKey: validated.idempotencyKey,
        operation,
        commandFingerprint,
        subjectType: entity.type,
        subjectId: entity.value.id,
        value: receipt,
        change,
        occurredAtUtc
      })
      return { value: receipt, change, replayed: false }
    })
  }

  trashEntity(request: EntityMutationRequest): MutationResult<EntityRecord> {
    return this.setDeletedState(request, true)
  }

  restoreEntity(request: EntityMutationRequest): MutationResult<EntityRecord> {
    return this.setDeletedState(request, false)
  }

  permanentlyDeleteEntity(
    request: PermanentlyDeleteEntityRequest
  ): MutationResult<PermanentDeleteReceipt> {
    const validated = permanentlyDeleteEntityRequestSchema.parse(request)
    const operation = 'entities.permanently-delete.v2'
    const commandFingerprint = fingerprint(operation, validated.payload)

    return this.database.transaction(() => {
      const replay = this.readReceipt(
        validated.idempotencyKey,
        operation,
        commandFingerprint,
        (value) => permanentDeleteReceiptSchema.parse(value)
      )
      if (replay) return replay

      const current = this.getEntity(validated.payload.entity)
      if (!current) {
        throw new EntityNotFoundError(validated.payload.entity.type, validated.payload.entity.id)
      }
      this.assertRevision(current.value.revision, validated.payload.expectedRevision)
      if (current.value.deletedAtUtc === null) {
        throw new StorageConflictError('not-in-trash', 'Entity must be in the trash before permanent deletion')
      }

      const occurredAtUtc = nowUtc(this.clock)
      const change = this.insertChange(
        occurredAtUtc,
        [this.topicForEntity(validated.payload.entity.type)],
        [validated.payload.entity]
      )

      this.removeGeneratedItemsForEntity(validated.payload.entity, occurredAtUtc)
      this.redactDailyLogReceiptsForEntity(validated.payload.entity, occurredAtUtc)

      const submitReceipts = this.database.connection.prepare(`
        SELECT change_sequence, result_change_json FROM idempotency_receipts
        WHERE subject_type = ? AND subject_id = ? AND operation = 'drafts.submit.v3'
      `).all(validated.payload.entity.type, validated.payload.entity.id) as Array<{
        change_sequence: number | bigint
        result_change_json: string
      }>
      for (const receipt of submitReceipts) {
        const submittedChange = changeEventSchema.parse(JSON.parse(receipt.result_change_json) as unknown)
        for (const reference of submittedChange.entityRefs) {
          if (reference.type !== 'draft') continue
          const priorSubmissions = this.database.connection.prepare(`
            SELECT result_change_json FROM idempotency_receipts
            WHERE operation = 'drafts.submit.v3' AND change_sequence < ?
            ORDER BY change_sequence DESC
          `).all(receipt.change_sequence) as Array<{ result_change_json: string }>
          let lowerBound = 0
          for (const prior of priorSubmissions) {
            const priorChange = changeEventSchema.parse(JSON.parse(prior.result_change_json) as unknown)
            if (priorChange.entityRefs.some((item) => item.type === 'draft' && item.id === reference.id)) {
              lowerBound = priorChange.sequence
              break
            }
          }
          this.database.connection.prepare(`
            UPDATE idempotency_receipts
            SET result_json = NULL, redacted_at_utc = ?
            WHERE subject_type = 'draft' AND subject_id = ?
              AND change_sequence > ? AND change_sequence <= ?
          `).run(occurredAtUtc, reference.id, lowerBound, receipt.change_sequence)
        }
      }

      this.database.connection.prepare(`
        DELETE FROM operation_history
        WHERE entity_type = ? AND entity_id = ?
      `).run(validated.payload.entity.type, validated.payload.entity.id)

      this.database.connection.prepare(`
        UPDATE idempotency_receipts
        SET result_json = NULL, redacted_at_utc = ?
        WHERE subject_type = ? AND subject_id = ?
      `).run(occurredAtUtc, validated.payload.entity.type, validated.payload.entity.id)

      this.deleteEntityRow(validated.payload.entity)

      const receipt = permanentDeleteReceiptSchema.parse({
        entityType: validated.payload.entity.type,
        entityId: validated.payload.entity.id,
        permanentlyDeletedAtUtc: occurredAtUtc,
        changeSequence: change.sequence
      })
      this.writeReceipt({
        idempotencyKey: validated.idempotencyKey,
        operation,
        commandFingerprint,
        subjectType: validated.payload.entity.type,
        subjectId: validated.payload.entity.id,
        value: receipt,
        change,
        occurredAtUtc
      })
      return { value: receipt, change, replayed: false }
    })
  }

  getDataRevision(): number {
    const row = this.database.connection.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS revision FROM change_events
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
      const existing = this.readSetting('app.timeZone')
      if (existing !== undefined) return ianaTimeZoneSchema.parse(existing)
      this.writeSetting('app.timeZone', validatedDefault, nowUtc(this.clock))
      return validatedDefault
    })
  }

  getOrCreateAppearance(defaultLocale: string): AppearanceSettings {
    const validatedLocale = localeSchema.parse(defaultLocale)
    return this.database.transaction(() => {
      const locale = this.readSetting('appearance.locale')
      const theme = this.readSetting('appearance.theme')
      const occurredAtUtc = nowUtc(this.clock)
      if (locale === undefined) this.writeSetting('appearance.locale', validatedLocale, occurredAtUtc)
      if (theme === undefined) this.writeSetting('appearance.theme', 'system', occurredAtUtc)
      return appearanceSettingsSchema.parse({
        locale: locale ?? validatedLocale,
        theme: theme ?? 'system'
      })
    })
  }

  getOrCreateCaptureShortcut(defaultAccelerator: string): string {
    const validatedDefault = shortcutAcceleratorSchema.parse(defaultAccelerator)
    return this.database.transaction(() => {
      const existing = this.readSetting(CAPTURE_SHORTCUT_SETTING_KEY)
      if (existing !== undefined) return shortcutAcceleratorSchema.parse(existing)
      this.writeSetting(CAPTURE_SHORTCUT_SETTING_KEY, validatedDefault, nowUtc(this.clock))
      return validatedDefault
    })
  }

  updateCaptureShortcut(
    request: UpdateShortcutRequest
  ): MutationResult<{ accelerator: string }> {
    const validated = updateShortcutRequestSchema.parse(request)
    return this.mutate({
      operation: 'settings.update-capture-shortcut.v3',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'settings',
      subjectId: null,
      topics: ['settings'],
      entityRefs: [],
      parseValue: (value) => captureShortcutSettingSchema.parse(value),
      perform: (occurredAtUtc) => {
        this.writeSetting(
          CAPTURE_SHORTCUT_SETTING_KEY,
          validated.payload.accelerator,
          occurredAtUtc
        )
        return captureShortcutSettingSchema.parse({
          accelerator: validated.payload.accelerator
        })
      }
    })
  }

  updateAppearance(request: UpdateAppearanceRequest): MutationResult<AppearanceSettings> {
    const validated = updateAppearanceRequestSchema.parse(request)
    const current = this.getOrCreateAppearance('en-US')
    return this.mutate({
      operation: 'settings.update-appearance.v2',
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: 'settings',
      subjectId: null,
      topics: ['settings'],
      entityRefs: [],
      parseValue: (value) => appearanceSettingsSchema.parse(value),
      perform: (occurredAtUtc) => {
        const next = appearanceSettingsSchema.parse({
          locale: validated.payload.locale ?? current.locale,
          theme: validated.payload.theme ?? current.theme
        })
        this.writeSetting('appearance.locale', next.locale, occurredAtUtc)
        this.writeSetting('appearance.theme', next.theme, occurredAtUtc)
        return next
      }
    })
  }

  listCurrentTasks(date?: DateOnly): Task[] {
    const queryDate = date ?? dateForInstantInTimeZone(this.clock.now(), this.currentTimeZone())
    const rows = this.database.connection.prepare(`
      SELECT tasks.*
      FROM tasks
      LEFT JOIN operation_history created
        ON created.entity_type = 'task'
       AND created.entity_id = tasks.id
       AND created.operation = 'task.created'
      WHERE tasks.deleted_at_utc IS NULL
        AND tasks.completed_at_utc IS NULL
        AND (tasks.plan_date IS NULL OR tasks.plan_date <= ?)
      ORDER BY
        CASE WHEN tasks.due_date IS NULL THEN 1 ELSE 0 END,
        tasks.due_date,
        CASE WHEN tasks.plan_date IS NULL THEN 1 ELSE 0 END,
        tasks.plan_date,
        created.sequence,
        tasks.id
    `).all(queryDate) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  listFutureTasks(date?: DateOnly): Task[] {
    const queryDate = date ?? dateForInstantInTimeZone(this.clock.now(), this.currentTimeZone())
    const rows = this.database.connection.prepare(`
      SELECT tasks.*
      FROM tasks
      LEFT JOIN operation_history created
        ON created.entity_type = 'task'
       AND created.entity_id = tasks.id
       AND created.operation = 'task.created'
      WHERE tasks.deleted_at_utc IS NULL
        AND tasks.completed_at_utc IS NULL
        AND tasks.plan_date > ?
      ORDER BY tasks.plan_date, created.sequence, tasks.id
    `).all(queryDate) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  close(): void {
    this.database.close()
  }

  private mutate<T>(options: MutationOptions<T>): MutationResult<T> {
    const commandFingerprint = fingerprint(options.operation, options.payload)
    return this.database.transaction(() => {
      const replay = this.readReceipt(
        options.idempotencyKey,
        options.operation,
        commandFingerprint,
        options.parseValue
      )
      if (replay) return replay

      const occurredAtUtc = nowUtc(this.clock)
      const value = options.perform(occurredAtUtc)
      const change = this.insertChange(
        occurredAtUtc,
        options.topics,
        options.entityRefs
      )
      options.afterChange?.(value, change, occurredAtUtc)
      this.writeReceipt({
        idempotencyKey: options.idempotencyKey,
        operation: options.operation,
        commandFingerprint,
        subjectType: options.subjectType,
        subjectId: options.subjectId,
        value,
        change,
        occurredAtUtc
      })
      return { value, change, replayed: false }
    })
  }

  private mutateTask(
    operation: string,
    idempotencyKey: string,
    payload: { id: string; expectedRevision?: number },
    historyOperation: OperationKind,
    transform: (current: Task, occurredAtUtc: string) => Task
  ): MutationResult<Task> {
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation,
      idempotencyKey,
      payload,
      subjectType: 'task',
      subjectId: payload.id,
      topics: ['tasks'],
      entityRefs: [{ type: 'task', id: payload.id }],
      parseValue: (value) => taskSchema.parse(value),
      perform: (occurredAtUtc) => {
        const current = this.requireActiveEntity({ type: 'task', id: payload.id })
        if (current.type !== 'task') throw new Error('Unexpected entity type')
        if (payload.expectedRevision !== undefined) {
          this.assertRevision(current.value.revision, payload.expectedRevision)
        }
        const task = transform(current.value, occurredAtUtc)
        this.database.connection.prepare(`
          UPDATE tasks
          SET title = ?, body_markdown = ?, plan_date = ?, due_date = ?,
              completed_at_utc = ?, revision = ?, updated_at_utc = ?
          WHERE id = ?
        `).run(
          task.title, task.bodyMarkdown, task.planDate, task.dueDate,
          task.completedAtUtc, task.revision, task.updatedAtUtc, task.id
        )
        return task
      },
      afterChange: (task, change, occurredAtUtc) => {
        this.recordHistory({ type: 'task', value: task }, historyOperation, change, occurredAtUtc, timeZone)
      }
    })
  }

  private setDeletedState(
    request: EntityMutationRequest,
    deleted: boolean
  ): MutationResult<EntityRecord> {
    const validated = entityMutationRequestSchema.parse(request)
    const operation = deleted ? 'entities.trash.v2' : 'entities.restore.v2'
    const historyOperation: OperationKind = deleted ? 'entity.trashed' : 'entity.restored'
    const timeZone = this.currentTimeZone()
    return this.mutate({
      operation,
      idempotencyKey: validated.idempotencyKey,
      payload: validated.payload,
      subjectType: validated.payload.entity.type,
      subjectId: validated.payload.entity.id,
      topics: [this.topicForEntity(validated.payload.entity.type)],
      entityRefs: [validated.payload.entity],
      parseValue: (value) => entityRecordSchema.parse(value),
      perform: (occurredAtUtc) => {
        const current = this.getEntity(validated.payload.entity)
        if (!current) {
          throw new EntityNotFoundError(validated.payload.entity.type, validated.payload.entity.id)
        }
        this.assertRevision(current.value.revision, validated.payload.expectedRevision)
        if (deleted && current.value.deletedAtUtc !== null) {
          throw new StorageConflictError('already-trashed', 'Entity is already in the trash')
        }
        if (!deleted && current.value.deletedAtUtc === null) {
          throw new StorageConflictError('not-in-trash', 'Entity is not in the trash')
        }
        const next = entityRecordSchema.parse({
          type: current.type,
          value: {
            ...current.value,
            revision: current.value.revision + 1,
            updatedAtUtc: occurredAtUtc,
            deletedAtUtc: deleted ? occurredAtUtc : null
          }
        })
        this.updateEntityLifecycle(next)
        return next
      },
      afterChange: (entity, change, occurredAtUtc) => {
        this.recordHistory(entity, historyOperation, change, occurredAtUtc, timeZone)
        if (deleted) this.removeGeneratedItemsForEntity(validated.payload.entity, occurredAtUtc)
      }
    })
  }

  private readReceipt<T>(
    idempotencyKey: string,
    operation: string,
    commandFingerprint: string,
    parseValue: (value: unknown) => T
  ): MutationResult<T> | undefined {
    const row = this.database.connection.prepare(`
      SELECT operation, command_fingerprint, subject_type, subject_id,
             result_json, result_change_json, redacted_at_utc
      FROM idempotency_receipts
      WHERE idempotency_key = ?
    `).get(idempotencyKey) as unknown as ReceiptRow | undefined
    if (!row) return undefined
    if (row.operation !== operation || row.command_fingerprint !== commandFingerprint) {
      throw new IdempotencyConflictError(idempotencyKey)
    }
    if (row.result_json === null || row.redacted_at_utc !== null) {
      throw new EntityNotFoundError(
        row.subject_type ?? 'entity',
        row.subject_id ?? idempotencyKey,
        'The original idempotent result was removed by permanent deletion'
      )
    }
    return {
      value: parseValue(JSON.parse(row.result_json) as unknown),
      change: changeEventSchema.parse(JSON.parse(row.result_change_json) as unknown),
      replayed: true
    }
  }

  private writeReceipt(input: {
    idempotencyKey: string
    operation: string
    commandFingerprint: string
    subjectType: string | null
    subjectId: string | null
    value: unknown
    change: ChangeEvent
    occurredAtUtc: string
  }): void {
    this.database.connection.prepare(`
      INSERT INTO idempotency_receipts (
        idempotency_key, operation, command_fingerprint, subject_type, subject_id,
        result_json, result_change_json, change_sequence, redacted_at_utc, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.idempotencyKey,
      input.operation,
      input.commandFingerprint,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.value),
      JSON.stringify(input.change),
      input.change.sequence,
      null,
      input.occurredAtUtc
    )
  }

  private insertChange(
    occurredAtUtc: string,
    topics: ChangeTopic[],
    entityRefs: ChangeEntityReference[]
  ): ChangeEvent {
    const eventId = randomUUID()
    const result = this.database.connection.prepare(`
      INSERT INTO change_events (event_id, occurred_at_utc, topics_json, entity_refs_json)
      VALUES (?, ?, ?, ?)
    `).run(eventId, occurredAtUtc, JSON.stringify(topics), JSON.stringify(entityRefs))
    return changeEventSchema.parse({
      eventId,
      sequence: integer(result.lastInsertRowid, 'change sequence'),
      occurredAtUtc,
      topics,
      entityRefs
    })
  }

  private recordHistory(
    entity: EntityRecord,
    operation: OperationKind,
    change: ChangeEvent,
    occurredAtUtc: string,
    timeZone: string
  ): void {
    const snapshot = operationSnapshotSchema.parse({
      operationId: randomUUID(),
      sequence: change.sequence,
      entityType: entity.type,
      entityId: entity.value.id,
      operation,
      occurredAtUtc,
      attributionDate: dateForInstantInTimeZone(occurredAtUtc, timeZone),
      attributionTimeZone: timeZone,
      entityRevision: entity.value.revision,
      snapshot: entity
    })
    this.database.connection.prepare(`
      INSERT INTO operation_history (
        operation_id, sequence, entity_type, entity_id, operation,
        occurred_at_utc, attribution_date, attribution_time_zone,
        entity_revision, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.operationId, snapshot.sequence, snapshot.entityType, snapshot.entityId,
      snapshot.operation, snapshot.occurredAtUtc, snapshot.attributionDate,
      snapshot.attributionTimeZone, snapshot.entityRevision, JSON.stringify(snapshot.snapshot)
    )
  }

  private readTask(id: string): Task | undefined {
    const row = this.database.connection.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as TaskRow | undefined
    return row ? taskFromRow(row) : undefined
  }

  private readNote(id: string): Note | undefined {
    const row = this.database.connection.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as unknown as NoteRow | undefined
    return row ? noteFromRow(row) : undefined
  }

  private readSchedule(id: string): Schedule | undefined {
    const row = this.database.connection.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as unknown as ScheduleRow | undefined
    return row ? scheduleFromRow(row) : undefined
  }

  private requireActiveEntity(reference: EntityReference): EntityRecord {
    const entity = this.getEntity(reference)
    if (!entity) throw new EntityNotFoundError(reference.type, reference.id)
    if (entity.value.deletedAtUtc !== null) {
      throw new StorageConflictError('entity-in-trash', 'Entity in the trash cannot be edited')
    }
    return entity
  }

  private assertRevision(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new StorageConflictError(
        'revision-mismatch',
        `Expected revision ${expected}, received ${actual}`
      )
    }
  }

  private createEntityFromDraft(
    draft: Draft,
    entityId: string,
    occurredAtUtc: string
  ): EntityRecord {
    const common = {
      id: entityId,
      revision: 1,
      createdAtUtc: occurredAtUtc,
      updatedAtUtc: occurredAtUtc,
      deletedAtUtc: null
    }

    if (draft.captureKind === 'note' && draft.payload.kind === 'note') {
      if (!draft.payload.title.trim() && !draft.payload.bodyMarkdown.trim()) {
        throw new StorageConflictError(
          'empty-note',
          'A note draft must contain a title or body before submission'
        )
      }
      const note = noteSchema.parse({
        ...common,
        title: draft.payload.title,
        bodyMarkdown: draft.payload.bodyMarkdown
      })
      this.database.connection.prepare(`
        INSERT INTO notes (
          id, title, body_markdown, revision, created_at_utc, updated_at_utc, deleted_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        note.id, note.title, note.bodyMarkdown, note.revision,
        note.createdAtUtc, note.updatedAtUtc, note.deletedAtUtc
      )
      return entityRecordSchema.parse({ type: 'note', value: note })
    }

    if (draft.captureKind === 'task' && draft.payload.kind === 'task') {
      if (!draft.payload.title.trim()) {
        throw new StorageConflictError(
          'incomplete-task',
          'A task draft requires a non-empty title before submission'
        )
      }
      const task = taskSchema.parse({
        ...common,
        title: draft.payload.title,
        bodyMarkdown: draft.payload.bodyMarkdown,
        planDate: draft.payload.planDate,
        dueDate: draft.payload.dueDate,
        completedAtUtc: null
      })
      this.database.connection.prepare(`
        INSERT INTO tasks (
          id, title, body_markdown, plan_date, due_date, completed_at_utc,
          revision, created_at_utc, updated_at_utc, deleted_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.title, task.bodyMarkdown, task.planDate, task.dueDate,
        task.completedAtUtc, task.revision, task.createdAtUtc, task.updatedAtUtc,
        task.deletedAtUtc
      )
      return entityRecordSchema.parse({ type: 'task', value: task })
    }

    if (draft.captureKind === 'schedule' && draft.payload.kind === 'timed-schedule') {
      if (!draft.payload.title.trim() ||
          draft.payload.startAtUtc === null || draft.payload.endAtUtc === null) {
        throw new StorageConflictError(
          'incomplete-schedule',
          'A timed schedule draft requires a title, start time, and end time before submission'
        )
      }
      const schedule = scheduleSchema.parse({
        ...common,
        kind: 'timed',
        title: draft.payload.title,
        bodyMarkdown: draft.payload.bodyMarkdown,
        startAtUtc: draft.payload.startAtUtc,
        endAtUtc: draft.payload.endAtUtc
      })
      this.insertSchedule(schedule)
      return entityRecordSchema.parse({ type: 'schedule', value: schedule })
    }

    if (draft.captureKind === 'schedule' && draft.payload.kind === 'all-day-schedule') {
      if (!draft.payload.title.trim() ||
          draft.payload.startDate === null || draft.payload.endDateExclusive === null) {
        throw new StorageConflictError(
          'incomplete-schedule',
          'An all-day schedule draft requires a title, start date, and end date before submission'
        )
      }
      const schedule = scheduleSchema.parse({
        ...common,
        kind: 'all-day',
        title: draft.payload.title,
        bodyMarkdown: draft.payload.bodyMarkdown,
        startDate: draft.payload.startDate,
        endDateExclusive: draft.payload.endDateExclusive
      })
      this.insertSchedule(schedule)
      return entityRecordSchema.parse({ type: 'schedule', value: schedule })
    }

    throw new StorageConflictError(
      'draft-kind-mismatch',
      'Draft capture kind does not match its persisted payload'
    )
  }

  private createdOperationForEntity(type: EntityType): OperationKind {
    return type === 'task'
      ? 'task.created'
      : type === 'note'
        ? 'note.created'
        : 'schedule.created'
  }

  private insertSchedule(schedule: Schedule): void {
    this.database.connection.prepare(`
      INSERT INTO schedules (
        id, kind, title, body_markdown, start_at_utc, end_at_utc,
        start_date, end_date_exclusive, revision, created_at_utc,
        updated_at_utc, deleted_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      schedule.id,
      schedule.kind,
      schedule.title,
      schedule.bodyMarkdown,
      schedule.kind === 'timed' ? schedule.startAtUtc : null,
      schedule.kind === 'timed' ? schedule.endAtUtc : null,
      schedule.kind === 'all-day' ? schedule.startDate : null,
      schedule.kind === 'all-day' ? schedule.endDateExclusive : null,
      schedule.revision,
      schedule.createdAtUtc,
      schedule.updatedAtUtc,
      schedule.deletedAtUtc
    )
  }

  private updateScheduleRow(schedule: Schedule): void {
    this.database.connection.prepare(`
      UPDATE schedules
      SET kind = ?, title = ?, body_markdown = ?, start_at_utc = ?, end_at_utc = ?,
          start_date = ?, end_date_exclusive = ?, revision = ?, updated_at_utc = ?
      WHERE id = ?
    `).run(
      schedule.kind,
      schedule.title,
      schedule.bodyMarkdown,
      schedule.kind === 'timed' ? schedule.startAtUtc : null,
      schedule.kind === 'timed' ? schedule.endAtUtc : null,
      schedule.kind === 'all-day' ? schedule.startDate : null,
      schedule.kind === 'all-day' ? schedule.endDateExclusive : null,
      schedule.revision,
      schedule.updatedAtUtc,
      schedule.id
    )
  }

  private updateEntityLifecycle(entity: EntityRecord): void {
    const table = entity.type === 'task' ? 'tasks' : entity.type === 'note' ? 'notes' : 'schedules'
    this.database.connection.prepare(`
      UPDATE ${table}
      SET revision = ?, updated_at_utc = ?, deleted_at_utc = ?
      WHERE id = ?
    `).run(
      entity.value.revision,
      entity.value.updatedAtUtc,
      entity.value.deletedAtUtc,
      entity.value.id
    )
  }

  private deleteEntityRow(reference: EntityReference): void {
    const table = reference.type === 'task' ? 'tasks' : reference.type === 'note' ? 'notes' : 'schedules'
    this.database.connection.prepare(`DELETE FROM ${table} WHERE id = ?`).run(reference.id)
  }

  private topicForEntity(type: EntityType): ChangeTopic {
    return type === 'task' ? 'tasks' : type === 'note' ? 'notes' : 'schedules'
  }

  private listRecentNotes(): Note[] {
    const rows = this.database.connection.prepare(`
      SELECT * FROM notes
      WHERE deleted_at_utc IS NULL
      ORDER BY updated_at_utc DESC, revision DESC, id
    `).all() as unknown as NoteRow[]
    return rows.map(noteFromRow)
  }

  private listCompletedTasksForDate(date: DateOnly, timeZone: string): Task[] {
    const bounds = utcDayBounds(date, timeZone)
    const rows = this.database.connection.prepare(`
      SELECT * FROM tasks
      WHERE deleted_at_utc IS NULL
        AND completed_at_utc >= ? AND completed_at_utc < ?
      ORDER BY completed_at_utc DESC, id
    `).all(bounds.startAtUtc, bounds.endAtUtc) as unknown as TaskRow[]
    return rows.map(taskFromRow)
  }

  private listSchedulesForDate(date: DateOnly, timeZone: string) {
    const bounds = utcDayBounds(date, timeZone)
    const rows = this.database.connection.prepare(`
      SELECT * FROM schedules
      WHERE deleted_at_utc IS NULL
        AND (
          (kind = 'timed' AND start_at_utc < ? AND end_at_utc > ?)
          OR
          (kind = 'all-day' AND start_date <= ? AND end_date_exclusive > ?)
        )
      ORDER BY
        CASE WHEN kind = 'all-day' THEN 0 ELSE 1 END,
        COALESCE(start_date, start_at_utc),
        created_at_utc,
        id
    `).all(bounds.endAtUtc, bounds.startAtUtc, date, date) as unknown as ScheduleRow[]

    return rows.map(scheduleFromRow).map((schedule) => ({
      schedule,
      queryDate: date,
      continuesBefore: schedule.kind === 'timed'
        ? schedule.startAtUtc < bounds.startAtUtc
        : schedule.startDate < date,
      continuesAfter: schedule.kind === 'timed'
        ? schedule.endAtUtc > bounds.endAtUtc
        : schedule.endDateExclusive > bounds.nextDate
    }))
  }

  private readDailyLog(date: DateOnly): DailyLog | undefined {
    const row = this.database.connection.prepare(`
      SELECT * FROM daily_logs WHERE log_date = ?
    `).get(date) as unknown as DailyLogRow | undefined
    if (!row) return undefined
    const items = this.database.connection.prepare(`
      SELECT * FROM daily_log_items WHERE log_date = ?
      ORDER BY CASE section
        WHEN 'completed' THEN 0 WHEN 'pending-at-boundary' THEN 1
        WHEN 'planned' THEN 2 ELSE 3 END, stable_order, source_entity_id
    `).all(date) as unknown as DailyLogItemRow[]
    return dailyLogSchema.parse({
      id: row.id,
      logDate: row.log_date,
      attributionTimeZone: row.attribution_time_zone,
      generatedAtUtc: row.generated_at_utc,
      generationVersion: integer(row.generation_version, 'Daily Log generation version'),
      autoItems: items.map((item) => dailyLogItemSchema.parse({
        id: item.id,
        section: item.section,
        sourceEntityType: item.source_entity_type,
        sourceEntityId: item.source_entity_id,
        sourceOperationId: item.source_operation_id,
        stableOrder: integer(item.stable_order, 'Daily Log item order'),
        snapshotMarkdown: item.snapshot_markdown
      })),
      manualMarkdown: row.manual_markdown,
      manualRevision: integer(row.manual_revision, 'Daily Log manual revision'),
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc
    })
  }

  private removeGeneratedItemsForEntity(reference: EntityReference, occurredAtUtc: string): void {
    const dates = this.database.connection.prepare(`
      SELECT DISTINCT log_date FROM daily_log_items
      WHERE source_entity_type = ? AND source_entity_id = ?
    `).all(reference.type, reference.id) as Array<{ log_date: string }>
    this.database.connection.prepare(`
      DELETE FROM daily_log_items
      WHERE source_entity_type = ? AND source_entity_id = ?
    `).run(reference.type, reference.id)
    const update = this.database.connection.prepare(`
      UPDATE daily_logs SET generated_at_utc = ?, updated_at_utc = ? WHERE log_date = ?
    `)
    for (const row of dates) update.run(occurredAtUtc, occurredAtUtc, row.log_date)
  }

  private redactDailyLogReceiptsForEntity(reference: EntityReference, occurredAtUtc: string): void {
    const receipts = this.database.connection.prepare(`
      SELECT idempotency_key, result_json FROM idempotency_receipts
      WHERE subject_type = 'daily-log' AND result_json IS NOT NULL
    `).all() as Array<{ idempotency_key: string; result_json: string }>
    const redact = this.database.connection.prepare(`
      UPDATE idempotency_receipts
      SET result_json = NULL, redacted_at_utc = ? WHERE idempotency_key = ?
    `)
    for (const receipt of receipts) {
      const log = dailyLogSchema.parse(JSON.parse(receipt.result_json) as unknown)
      if (log.autoItems.some((item) =>
        item.sourceEntityType === reference.type && item.sourceEntityId === reference.id
      )) {
        redact.run(occurredAtUtc, receipt.idempotency_key)
      }
    }
  }

  private generateDailyLog(date: DateOnly): DailyLog {
    const occurredAtUtc = nowUtc(this.clock)
    const existing = this.readDailyLog(date)
    const timeZone = existing?.attributionTimeZone ?? this.currentTimeZone()
    const today = dateForInstantInTimeZone(occurredAtUtc, timeZone)
    const bounds = utcDayBounds(date, timeZone)
    const historical = date < today
    const cutoff = historical ? bounds.endAtUtc : occurredAtUtc
    const operator = historical ? '<' : '<='

    const latestRows = this.database.connection.prepare(`
      WITH ranked AS (
        SELECT history.*,
          ROW_NUMBER() OVER (
            PARTITION BY entity_type, entity_id
            ORDER BY occurred_at_utc DESC, sequence DESC
          ) AS row_number
        FROM operation_history history
        WHERE occurred_at_utc ${operator} ?
      )
      SELECT * FROM ranked WHERE row_number = 1
      ORDER BY sequence, entity_type, entity_id
    `).all(cutoff) as unknown as HistoryRow[]
    const originRows = this.database.connection.prepare(`
      SELECT entity_type, entity_id, operation, operation_id, attribution_date, sequence
      FROM operation_history
      WHERE occurred_at_utc ${operator} ?
        AND operation IN ('note.created', 'task.completed')
      ORDER BY occurred_at_utc, sequence
    `).all(cutoff) as Array<{
      entity_type: EntityType
      entity_id: string
      operation: OperationKind
      operation_id: string
      attribution_date: string
      sequence: number | bigint
    }>
    const noteOrigins = new Map<string, typeof originRows[number]>()
    const completions = new Map<string, typeof originRows[number]>()
    for (const row of originRows) {
      if (row.operation === 'note.created') noteOrigins.set(row.entity_id, row)
      if (row.operation === 'task.completed') completions.set(row.entity_id, row)
    }

    const active = new Set<string>()
    for (const type of ['task', 'note', 'schedule'] as const) {
      const table = type === 'task' ? 'tasks' : type === 'note' ? 'notes' : 'schedules'
      const rows = this.database.connection.prepare(`
        SELECT id FROM ${table} WHERE deleted_at_utc IS NULL
      `).all() as Array<{ id: string }>
      for (const row of rows) active.add(`${type}:${row.id}`)
    }

    type DesiredItem = Omit<DailyLogItem, 'id'>
    const desired: DesiredItem[] = []
    const safeTitle = (title: string): string => title.replace(/([\\`*_{}\[\]()#+.!>|-])/gu, '\\$1')
    const push = (
      section: DailyLogItem['section'], row: HistoryRow,
      markdown: string, sourceOperationId: string | null = row.operation_id
    ): void => {
      desired.push({
        section,
        sourceEntityType: row.entity_type,
        sourceEntityId: row.entity_id,
        sourceOperationId,
        stableOrder: integer(row.sequence, 'history sequence'),
        snapshotMarkdown: markdown
      })
    }

    for (const row of latestRows) {
      if (!active.has(`${row.entity_type}:${row.entity_id}`)) continue
      const snapshot = operationSnapshotSchema.parse({
        operationId: row.operation_id,
        sequence: integer(row.sequence, 'history sequence'),
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        occurredAtUtc: row.occurred_at_utc,
        attributionDate: row.attribution_date,
        attributionTimeZone: row.attribution_time_zone,
        entityRevision: integer(row.entity_revision, 'history entity revision'),
        snapshot: JSON.parse(row.snapshot_json) as unknown
      })
      const entity = snapshot.snapshot
      if (entity.value.deletedAtUtc !== null) continue

      if (entity.type === 'task' && !(!historical && date > today)) {
        const task = entity.value
        if (task.completedAtUtc === null && (task.planDate === null || task.planDate <= date)) {
          push('pending-at-boundary', row, `- [ ] ${safeTitle(task.title)}`)
        } else if (task.completedAtUtc !== null) {
          const completion = completions.get(task.id)
          if (completion?.attribution_date === date) {
            push('completed', row, `- [x] ${safeTitle(task.title)}`, completion.operation_id)
          }
        }
      } else if (entity.type === 'schedule') {
        const schedule = entity.value
        const overlaps = schedule.kind === 'timed'
          ? schedule.startAtUtc < bounds.endAtUtc && schedule.endAtUtc > bounds.startAtUtc
          : schedule.startDate <= date && schedule.endDateExclusive > date
        if (overlaps) {
          const when = schedule.kind === 'timed'
            ? `[${formatDailyLogInstant(schedule.startAtUtc, timeZone)}, ${formatDailyLogInstant(schedule.endAtUtc, timeZone)})`
            : `[${schedule.startDate}, ${schedule.endDateExclusive})`
          push('planned', row, `- ${safeTitle(schedule.title)} ${when}`)
        }
      } else if (entity.type === 'note' && !(!historical && date > today)) {
        if (noteOrigins.get(entity.value.id)?.attribution_date === date) {
          const title = entity.value.title ? `### ${safeTitle(entity.value.title)}\n\n` : ''
          const withTitle = `${title}${entity.value.bodyMarkdown}`
          push('notes', row, withTitle)
        }
      }
    }

    const sectionRank: Record<DailyLogItem['section'], number> = {
      completed: 0, 'pending-at-boundary': 1, planned: 2, notes: 3
    }
    desired.sort((left, right) =>
      sectionRank[left.section] - sectionRank[right.section] ||
      left.stableOrder - right.stableOrder ||
      left.sourceEntityId.localeCompare(right.sourceEntityId)
    )

    if (!existing) {
      this.database.connection.prepare(`
        INSERT INTO daily_logs (
          id, log_date, attribution_time_zone, generated_at_utc, generation_version,
          manual_markdown, manual_revision, created_at_utc, updated_at_utc
        ) VALUES (?, ?, ?, ?, 1, '', 0, ?, ?)
      `).run(randomUUID(), date, timeZone, occurredAtUtc, occurredAtUtc, occurredAtUtc)
    }
    const oldItems = new Map((existing?.autoItems ?? []).map((item) => [
      `${item.section}:${item.sourceEntityType}:${item.sourceEntityId}`, item
    ]))
    const nextItems = desired.map((item) => {
      const key = `${item.section}:${item.sourceEntityType}:${item.sourceEntityId}`
      return dailyLogItemSchema.parse({ ...item, id: oldItems.get(key)?.id ?? randomUUID() })
    })
    if (!existing || JSON.stringify(existing.autoItems) !== JSON.stringify(nextItems)) {
      this.database.connection.prepare('DELETE FROM daily_log_items WHERE log_date = ?').run(date)
      const insert = this.database.connection.prepare(`
        INSERT INTO daily_log_items (
          id, log_date, section, source_entity_type, source_entity_id,
          source_operation_id, stable_order, snapshot_markdown
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of nextItems) {
        insert.run(
          item.id, date, item.section, item.sourceEntityType, item.sourceEntityId,
          item.sourceOperationId, item.stableOrder, item.snapshotMarkdown
        )
      }
      if (existing) {
        this.database.connection.prepare(`
          UPDATE daily_logs SET generated_at_utc = ?, updated_at_utc = ? WHERE log_date = ?
        `).run(occurredAtUtc, occurredAtUtc, date)
      }
    }
    return this.readDailyLog(date)!
  }

  private currentTimeZone(): string {
    const existing = this.readSetting('app.timeZone')
    return existing === undefined
      ? this.getOrCreateAppTimeZone(systemTimeZone())
      : ianaTimeZoneSchema.parse(existing)
  }

  private readSetting(key: string): string | undefined {
    const row = this.database.connection.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(key) as { value?: string } | undefined
    return row?.value
  }

  private writeSetting(key: string, value: string, occurredAtUtc: string): void {
    this.database.connection.prepare(`
      INSERT INTO app_settings (key, value, updated_at_utc)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at_utc = excluded.updated_at_utc
    `).run(key, value, occurredAtUtc)
  }

  private backfillLegacyNoteHistory(): void {
    const rows = this.database.connection.prepare(`
      SELECT notes.*, receipts.change_sequence, changes.occurred_at_utc AS change_occurred_at_utc
      FROM notes
      JOIN idempotency_receipts receipts
        ON receipts.subject_type = 'note' AND receipts.subject_id = notes.id
      JOIN change_events changes ON changes.sequence = receipts.change_sequence
      LEFT JOIN operation_history history
        ON history.entity_type = 'note' AND history.entity_id = notes.id
      WHERE history.operation_id IS NULL
      ORDER BY receipts.change_sequence
    `).all() as unknown as Array<NoteRow & {
      change_sequence: number | bigint
      change_occurred_at_utc: string
    }>
    if (rows.length === 0) return

    const timeZone = this.readSetting('app.timeZone') ?? systemTimeZone()
    this.database.transaction(() => {
      for (const row of rows) {
        const note = noteFromRow(row)
        const sequence = integer(row.change_sequence, 'legacy Note change sequence')
        const snapshot = operationSnapshotSchema.parse({
          operationId: randomUUID(),
          sequence,
          entityType: 'note',
          entityId: note.id,
          operation: 'note.created',
          occurredAtUtc: row.change_occurred_at_utc,
          attributionDate: dateForInstantInTimeZone(row.change_occurred_at_utc, timeZone),
          attributionTimeZone: timeZone,
          entityRevision: note.revision,
          snapshot: { type: 'note', value: note }
        })
        this.database.connection.prepare(`
          INSERT INTO operation_history (
            operation_id, sequence, entity_type, entity_id, operation,
            occurred_at_utc, attribution_date, attribution_time_zone,
            entity_revision, snapshot_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snapshot.operationId, snapshot.sequence, snapshot.entityType, snapshot.entityId,
          snapshot.operation, snapshot.occurredAtUtc, snapshot.attributionDate,
          snapshot.attributionTimeZone, snapshot.entityRevision,
          JSON.stringify(snapshot.snapshot)
        )
      }
    })
  }
}

export {
  EntityNotFoundError,
  IdempotencyConflictError,
  StorageConflictError
}
