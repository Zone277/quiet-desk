import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  bootstrap,
  callQuietDesk,
  cleanIsolatedRoot,
  closeQuietDesk,
  ensureBuilt,
  expectOk,
  launchQuietDesk,
  makeIsolatedRoot,
  request
} from './stage3-harness.mjs'

const PREFIX = 'quietdesk-stage5-daily-log-'
const ZONE = 'Asia/Shanghai'
const A = '2026-09-21'
const B = '2026-09-22'
const C = '2026-09-23'
const INSTANT = {
  [A]: '2026-09-21T04:00:00.000Z',
  [B]: '2026-09-22T04:00:00.000Z',
  [C]: '2026-09-23T04:00:00.000Z'
}
const IDS = {
  task: '51000000-0000-4000-8000-000000000001',
  sameDayTask: '51000000-0000-4000-8000-000000000002',
  note: '51000000-0000-4000-8000-000000000003',
  schedule: '51000000-0000-4000-8000-000000000004'
}
const SECRET = 'STAGE5PRIVATETOKEN91c3f4'
const ORIGINAL_TITLE = `甲日任务 ${SECRET}`
const EDITED_TITLE = '丙日改题 / edited on C'
const NOTE_BODY = `中文笔记 🌙\n\n\`\`\`ts\nconst marker = '${SECRET}'\n\`\`\``
const MANUAL = `手写保留 ${SECRET}\n\n\`\`\`text\n手写代码块 中文\n\`\`\``

async function invoke(page, namespace, method, payload, mutation = false, idempotencyKey) {
  return await callQuietDesk(page, [namespace, method], request(payload, { mutation, idempotencyKey }))
}

async function success(page, namespace, method, payload, mutation = false, idempotencyKey) {
  return expectOk(
    await invoke(page, namespace, method, payload, mutation, idempotencyKey),
    `${namespace}.${method}`
  )
}

async function getLog(library, date) {
  const log = await success(library, 'dailyLogs', 'get', { date })
  assert.equal(log.logDate, date)
  assert.equal(log.attributionTimeZone, ZONE)
  assert.equal(new Set(log.autoItems.map((item) => item.id)).size, log.autoItems.length,
    `${date} has duplicate auto item IDs`)
  assert.equal(new Set(log.autoItems.map((item) => `${item.section}:${item.sourceEntityId}:${item.sourceOperationId ?? ''}`)).size,
    log.autoItems.length, `${date} has duplicate source/section keys`)
  return log
}

function items(log, section, entityId) {
  return log.autoItems.filter((item) => item.section === section && item.sourceEntityId === entityId)
}

function assertOne(log, section, entityId, text) {
  const matches = items(log, section, entityId)
  assert.equal(matches.length, 1, `${log.logDate}: expected one ${section} item for ${entityId}`)
  assert.ok(matches[0].snapshotMarkdown.includes(text), `${log.logDate}: ${section} lost ${text}`)
  assert.equal(matches[0].sourceEntityId, entityId)
  return matches[0]
}

function assertAbsent(log, entityId) {
  assert.equal(log.autoItems.some((item) => item.sourceEntityId === entityId), false,
    `${log.logDate}: hidden entity ${entityId} remained in auto log`)
}

async function start(root, date, pids, { now = INSTANT[date], testSystemZone = ZONE } = {}) {
  const runtime = await launchQuietDesk({
    userData: root,
    locale: 'zh-CN',
    extraEnv: { QUIETDESK_TEST_NOW: now, QUIETDESK_TEST_TIME_ZONE: testSystemZone }
  })
  pids.push(runtime.runtime.pid)
  const library = runtime.pages.get('library')
  const initial = await bootstrap(library, 'library')
  assert.equal(initial.contractVersion, 4)
  assert.equal(initial.stage, 5)
  assert.equal(initial.currentDate, date)
  assert.equal(initial.appTimeZone, ZONE)
  for (const capability of ['dailyLogs.get', 'dailyLogs.saveManual', 'dailyLogs.export']) {
    assert.ok(initial.implementedCapabilities.includes(capability), `missing ${capability}`)
  }
  return runtime
}

async function verifyAccess(runtime) {
  for (const kind of ['widget', 'capture']) {
    const page = runtime.pages.get(kind)
    for (const method of ['get', 'export']) {
      const denied = await invoke(page, 'dailyLogs', method, { date: A })
      assert.equal(denied.ok, false, `${kind} gained dailyLogs.${method}`)
      assert.equal(denied.error.code, 'FORBIDDEN')
    }
    const deniedSave = await invoke(page, 'dailyLogs', 'saveManual', {
      date: A, expectedRevision: 0, manualMarkdown: 'forbidden'
    }, true)
    assert.equal(deniedSave.ok, false, `${kind} gained dailyLogs.saveManual`)
    assert.equal(deniedSave.error.code, 'FORBIDDEN')
  }
  const malformed = await invoke(runtime.pages.get('library'), 'dailyLogs', 'export', {
    date: A, filePath: join('unexpected', 'path.md')
  })
  assert.equal(malformed.ok, false, 'renderer supplied a destination path')
  assert.equal(malformed.error.code, 'INVALID_REQUEST')
}

async function selectSaveDialog(runtime, result) {
  return await runtime.app.evaluate(({ dialog }, answer) => {
    dialog.showSaveDialog = async () => answer
    return true
  }, result)
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertPurgedDatabase(root) {
  const database = new DatabaseSync(join(root, 'data', 'quietdesk.sqlite3'))
  try {
    for (const [type, table] of [['task', 'tasks'], ['note', 'notes'], ['schedule', 'schedules']]) {
      const id = IDS[type]
      assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table} WHERE id = ?`).get(id).count, 0,
        `${type} row survived permanent deletion`)
      assert.equal(database.prepare('SELECT count(*) AS count FROM operation_history WHERE entity_id = ?').get(id).count,
        0, `${type} history survived permanent deletion`)
      assert.equal(database.prepare('SELECT count(*) AS count FROM daily_log_items WHERE source_entity_id = ?').get(id).count,
        0, `${type} auto-log item survived permanent deletion`)
      const receipts = database.prepare('SELECT result_json FROM idempotency_receipts WHERE subject_id = ?').all(id)
      assert.equal(JSON.stringify(receipts).includes(SECRET), false,
        `${type} receipt retained deleted content`)
    }
  } finally {
    database.close()
  }
}

async function assertSkippedDayAndBoundary() {
  const skippedRoot = await makeIsolatedRoot('quietdesk-stage5-skipped-')
  const skippedPids = []
  let skipped
  try {
    skipped = await start(skippedRoot, A, skippedPids)
    const task = await success(skipped.pages.get('capture'), 'tasks', 'create', {
      id: crypto.randomUUID(), title: '跨过乙日仍待办', bodyMarkdown: '', planDate: A, dueDate: null
    }, true)
    await closeQuietDesk(skipped)
    skipped = await start(skippedRoot, C, skippedPids, { testSystemZone: 'UTC' })
    const library = skipped.pages.get('library')
    const aLog = await getLog(library, A)
    const firstBView = await getLog(library, B)
    const cLog = await getLog(library, C)
    for (const log of [aLog, firstBView, cLog]) {
      assertOne(log, 'pending-at-boundary', task.id, '跨过乙日仍待办')
    }
    assert.deepEqual(await getLog(library, B), firstBView, 'skipped B was duplicated on repeat view')
    await closeQuietDesk(skipped)
    skipped = undefined
    const database = new DatabaseSync(join(skippedRoot, 'data', 'quietdesk.sqlite3'))
    try {
      assert.equal(database.prepare('SELECT count(*) AS count FROM daily_logs WHERE log_date = ?').get(B).count,
        1, 'first B view created more than one log')
    } finally {
      database.close()
    }
  } finally {
    await closeQuietDesk(skipped)
    await cleanIsolatedRoot(skippedRoot, 'quietdesk-stage5-skipped-')
  }

  const boundaryRoot = await makeIsolatedRoot('quietdesk-stage5-boundary-')
  const boundaryPids = []
  let boundary
  try {
    boundary = await start(boundaryRoot, A, boundaryPids, { now: '2026-09-21T15:59:59.999Z' })
    const task = await success(boundary.pages.get('capture'), 'tasks', 'create', {
      id: crypto.randomUUID(), title: '上海零点边界', bodyMarkdown: '', planDate: A, dueDate: null
    }, true)
    await closeQuietDesk(boundary)
    boundary = await start(boundaryRoot, B, boundaryPids, { now: '2026-09-21T16:00:00.000Z' })
    const completed = await success(boundary.pages.get('capture'), 'tasks', 'setCompletion', {
      id: task.id, expectedRevision: task.revision, action: 'complete'
    }, true)
    assert.equal(completed.completedAtUtc, '2026-09-21T16:00:00.000Z')
    assertOne(await getLog(boundary.pages.get('library'), A), 'pending-at-boundary', task.id, '上海零点边界')
    assertOne(await getLog(boundary.pages.get('library'), B), 'completed', task.id, '上海零点边界')
    const history = await success(boundary.pages.get('library'), 'library', 'getHistory', {
      type: 'task', id: task.id
    })
    assert.deepEqual(history.map((item) => item.attributionDate), [A, B])
  } finally {
    await closeQuietDesk(boundary)
    await cleanIsolatedRoot(boundaryRoot, 'quietdesk-stage5-boundary-')
  }
}

await ensureBuilt()
const root = await makeIsolatedRoot(PREFIX)
const pids = []
let runtime
let electronRuntime

try {
  runtime = await start(root, A, pids)
  electronRuntime = runtime.runtime
  await verifyAccess(runtime)
  const captureA = runtime.pages.get('capture')
  const libraryA = runtime.pages.get('library')
  const task = await success(captureA, 'tasks', 'create', {
    id: IDS.task, title: ORIGINAL_TITLE, bodyMarkdown: '原计划，不等于完成', planDate: A, dueDate: B
  }, true)
  const note = await success(captureA, 'notes', 'create', {
    id: IDS.note, title: '甲日记录', bodyMarkdown: NOTE_BODY
  }, true)
  const schedule = await success(captureA, 'schedules', 'create', {
    kind: 'all-day', id: IDS.schedule, title: '甲日安排', bodyMarkdown: '仅为计划',
    startDate: A, endDateExclusive: B
  }, true)
  assert.equal(task.revision, 1)
  assert.equal(note.revision, 1)
  assert.equal(schedule.revision, 1)

  let logA = await getLog(libraryA, A)
  assertOne(logA, 'pending-at-boundary', IDS.task, ORIGINAL_TITLE)
  assert.equal(items(logA, 'completed', IDS.task).length, 0)
  assertOne(logA, 'planned', IDS.schedule, '甲日安排')
  assertOne(logA, 'notes', IDS.note, '中文笔记')
  assert.deepEqual(await getLog(libraryA, A), logA, 'A repeated generation changed unchanged log')
  const manualKey = crypto.randomUUID()
  const savedManual = await success(libraryA, 'dailyLogs', 'saveManual', {
    date: A, expectedRevision: 0, manualMarkdown: MANUAL
  }, true, manualKey)
  assert.equal(savedManual.manualRevision, 1)
  assert.equal(savedManual.manualMarkdown, MANUAL)
  assert.deepEqual(await success(libraryA, 'dailyLogs', 'saveManual', {
    date: A, expectedRevision: 0, manualMarkdown: MANUAL
  }, true, manualKey), savedManual, 'idempotent replay changed manual log')
  const stale = await invoke(libraryA, 'dailyLogs', 'saveManual', {
    date: A, expectedRevision: 0, manualMarkdown: 'must not overwrite'
  }, true)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'CONFLICT')
  logA = await getLog(libraryA, A)
  assert.equal(logA.manualMarkdown, MANUAL)
  assert.equal(logA.manualRevision, 1)

  await closeQuietDesk(runtime)
  runtime = await start(root, B, pids)
  let library = runtime.pages.get('library')
  let capture = runtime.pages.get('capture')
  assert.deepEqual(await getLog(library, A), logA, 'A changed after B startup')
  const completed = await success(capture, 'tasks', 'setCompletion', {
    id: IDS.task, expectedRevision: task.revision, action: 'complete'
  }, true)
  let logB = await getLog(library, B)
  assertOne(logB, 'completed', IDS.task, ORIGINAL_TITLE)
  assert.equal(items(logB, 'pending-at-boundary', IDS.task).length, 0)
  const sameDayTask = await success(capture, 'tasks', 'create', {
    id: IDS.sameDayTask, title: '同日完成再重开', bodyMarkdown: '', planDate: B, dueDate: null
  }, true)
  const sameDayCompleted = await success(capture, 'tasks', 'setCompletion', {
    id: IDS.sameDayTask, expectedRevision: sameDayTask.revision, action: 'complete'
  }, true)
  await success(capture, 'tasks', 'setCompletion', {
    id: IDS.sameDayTask, expectedRevision: sameDayCompleted.revision, action: 'reopen'
  }, true)
  logB = await getLog(library, B)
  assertOne(logB, 'completed', IDS.task, ORIGINAL_TITLE)
  assertOne(logB, 'pending-at-boundary', IDS.sameDayTask, '同日完成再重开')
  assert.equal(items(logB, 'completed', IDS.sameDayTask).length, 0)
  const history = await success(library, 'library', 'getHistory', { type: 'task', id: IDS.sameDayTask })
  assert.deepEqual(history.map((item) => item.operation), ['task.created', 'task.completed', 'task.reopened'])
  assert.deepEqual(await getLog(library, B), logB, 'B repeated generation changed unchanged log')

  await closeQuietDesk(runtime)
  runtime = await start(root, B, pids)
  library = runtime.pages.get('library')
  assert.deepEqual(await getLog(library, A), logA, 'A changed after B process restart')
  assert.deepEqual(await getLog(library, B), logB, 'B changed after process restart')
  await closeQuietDesk(runtime)

  runtime = await start(root, C, pids)
  library = runtime.pages.get('library')
  capture = runtime.pages.get('capture')
  assert.deepEqual(await getLog(library, A), logA, 'A changed after skipped-day startup')
  assert.deepEqual(await getLog(library, B), logB, 'B changed after skipped-day startup')
  const edited = await success(capture, 'tasks', 'update', {
    id: IDS.task, expectedRevision: completed.revision, title: EDITED_TITLE,
    bodyMarkdown: '丙日新正文', planDate: A, dueDate: B
  }, true)
  const rescheduled = await success(capture, 'tasks', 'reschedule', {
    id: IDS.task, expectedRevision: edited.revision, planDate: C, dueDate: null
  }, true)
  await success(capture, 'tasks', 'setCompletion', {
    id: IDS.task, expectedRevision: rescheduled.revision, action: 'reopen'
  }, true)
  const logC = await getLog(library, C)
  assertOne(logC, 'pending-at-boundary', IDS.task, EDITED_TITLE)
  assert.equal(items(logC, 'completed', IDS.task).length, 0)
  assert.deepEqual(await getLog(library, A), logA, 'C edit/replan/reopen rewrote A')
  assert.deepEqual(await getLog(library, B), logB, 'C edit/replan/reopen rewrote B')

  const beforeTrash = {
    task: await success(library, 'library', 'getEntity', { type: 'task', id: IDS.task }),
    note: await success(library, 'library', 'getEntity', { type: 'note', id: IDS.note }),
    schedule: await success(library, 'library', 'getEntity', { type: 'schedule', id: IDS.schedule })
  }
  const trashed = {}
  for (const type of ['task', 'note', 'schedule']) {
    trashed[type] = await success(capture, 'entities', 'trash', {
      entity: { type, id: IDS[type] }, expectedRevision: beforeTrash[type].value.revision
    }, true)
  }
  for (const date of [A, B, C]) {
    const hidden = await getLog(library, date)
    for (const type of ['task', 'note', 'schedule']) assertAbsent(hidden, IDS[type])
    if (date === A) assert.equal(hidden.manualMarkdown, MANUAL)
  }
  assert.equal((await success(library, 'library', 'listTrash', {})).length >= 3, true)
  const restored = {}
  for (const type of ['task', 'note', 'schedule']) {
    restored[type] = await success(capture, 'entities', 'restore', {
      entity: { type, id: IDS[type] }, expectedRevision: trashed[type].value.revision
    }, true)
  }
  assertOne(await getLog(library, A), 'pending-at-boundary', IDS.task, ORIGINAL_TITLE)
  assertOne(await getLog(library, A), 'notes', IDS.note, '中文笔记')
  assertOne(await getLog(library, A), 'planned', IDS.schedule, '甲日安排')
  assertOne(await getLog(library, B), 'completed', IDS.task, ORIGINAL_TITLE)
  assertOne(await getLog(library, C), 'pending-at-boundary', IDS.task, EDITED_TITLE)

  const wrongConfirmation = await invoke(library, 'entities', 'permanentlyDelete', {
    entity: { type: 'note', id: IDS.note }, expectedRevision: restored.note.value.revision,
    confirmedEntityId: IDS.task
  }, true)
  assert.equal(wrongConfirmation.ok, false)
  assert.equal(wrongConfirmation.error.code, 'INVALID_REQUEST')
  assert.equal((await success(library, 'library', 'getEntity', { type: 'note', id: IDS.note })).value.id, IDS.note)

  const beforeDeleteFile = join(root, 'export-before-delete.md')
  await selectSaveDialog(runtime, { canceled: false, filePath: beforeDeleteFile })
  assert.deepEqual(await success(library, 'dailyLogs', 'export', { date: A }), { status: 'saved' })
  const priorCopy = await readFile(beforeDeleteFile, 'utf8')
  assert.ok(priorCopy.includes('中文笔记') && priorCopy.includes(SECRET))
  assert.ok(priorCopy.includes('```'), 'Markdown code fence missing from export')

  const softHiddenFile = join(root, 'export-soft-hidden.md')
  await success(capture, 'entities', 'trash', {
    entity: { type: 'note', id: IDS.note }, expectedRevision: restored.note.value.revision
  }, true)
  await selectSaveDialog(runtime, { canceled: false, filePath: softHiddenFile })
  assert.deepEqual(await success(library, 'dailyLogs', 'export', { date: A }), { status: 'saved' })
  const softHidden = await readFile(softHiddenFile, 'utf8')
  assert.equal(softHidden.includes('中文笔记 🌙'), false, 'soft-deleted note leaked into a new export')
  assert.ok(softHidden.includes(MANUAL), 'soft delete removed independent manual text')
  restored.note = await success(capture, 'entities', 'restore', {
    entity: { type: 'note', id: IDS.note }, expectedRevision: restored.note.value.revision + 1
  }, true)

  for (const type of ['task', 'note', 'schedule']) {
    const moved = await success(capture, 'entities', 'trash', {
      entity: { type, id: IDS[type] }, expectedRevision: restored[type].value.revision
    }, true)
    await success(capture, 'entities', 'permanentlyDelete', {
      entity: { type, id: IDS[type] }, expectedRevision: moved.value.revision,
      confirmedEntityId: IDS[type]
    }, true)
  }
  for (const date of [A, B, C]) {
    const purged = await getLog(library, date)
    for (const type of ['task', 'note', 'schedule']) assertAbsent(purged, IDS[type])
    if (date === A) assert.equal(purged.manualMarkdown, MANUAL)
  }

  const canceledPath = join(root, 'cancelled-export.md')
  await selectSaveDialog(runtime, { canceled: true, filePath: canceledPath })
  assert.deepEqual(await success(library, 'dailyLogs', 'export', { date: A }), { status: 'cancelled' })
  assert.equal(await exists(canceledPath), false, 'cancelled export wrote a file')

  const freshPath = join(root, 'fresh-export.md')
  await selectSaveDialog(runtime, { canceled: false, filePath: freshPath })
  assert.deepEqual(await success(library, 'dailyLogs', 'export', { date: A }), { status: 'saved' })
  const freshBytes = await readFile(freshPath)
  const fresh = new TextDecoder('utf-8', { fatal: true }).decode(freshBytes)
  assert.ok(fresh.includes(MANUAL), 'independent manual text was removed by entity deletion')
  assert.ok(fresh.includes('中文') && fresh.includes('```'), 'UTF-8 Markdown/manual code block lost')
  for (const removed of [ORIGINAL_TITLE, EDITED_TITLE, '中文笔记 🌙', '甲日安排']) {
    assert.equal(fresh.includes(removed), false, `fresh export leaked deleted auto content: ${removed}`)
  }
  assert.equal((await readFile(beforeDeleteFile, 'utf8')), priorCopy,
    'deletion unexpectedly modified an independent earlier export')

  await closeQuietDesk(runtime)
  runtime = undefined
  assertPurgedDatabase(root)
  await assertSkippedDayAndBoundary()

  console.info(`STAGE5_DAILY_LOG_PASS ${JSON.stringify({ pids, electron: electronRuntime.electron,
    node: electronRuntime.node, sqlite: electronRuntime.sqlite, platform: electronRuntime.platform,
    zone: ZONE, days: [A, B, C],
    exportBytes: freshBytes.length, dialog: 'main-process test override',
    isolatedRoot: root })}`)
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(root, PREFIX)
}
