import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  assertCoreEntriesInViewport,
  assertSecurityBoundary,
  bootstrap,
  callQuietDesk,
  cleanIsolatedRoot,
  closeQuietDesk,
  ensureBuilt,
  expectOk,
  installChangeProbe,
  launchQuietDesk,
  makeIsolatedRoot,
  readChangeProbe,
  request,
  requiredCapabilities,
  setWidgetContentSize,
  shiftDateOnly,
  waitForEntityEvent,
  widgetSelectors,
  zonedLocalToUtc
} from './stage3-harness.mjs'

const ROOT_PREFIX = 'quietdesk-stage3-business-'
const TASK_ID = '31000000-0000-4000-8000-000000000001'
const TIMED_SCHEDULE_ID = '31000000-0000-4000-8000-000000000002'
const ALL_DAY_SCHEDULE_ID = '31000000-0000-4000-8000-000000000003'
const TASK_TITLE = '整理 QuietDesk 阶段三验收 ✅ / ArchitectureReviewWithoutConvenientBreakPoints / 中英文 mixed text'
const TASK_BODY = '检查 planDate / dueDate，保留中英文 mixed text。\n\nhttps://example.invalid/very/long/path 🌙'

function schedulesFor(day) {
  return day.schedules.map((item) => item.schedule.id).sort()
}

async function requireStage3Capabilities(runtime) {
  const snapshots = {}
  for (const [kind, page] of runtime.pages) {
    const snapshot = await bootstrap(page, kind)
    assert.equal(snapshot.contractVersion, 2, `${kind} did not bootstrap contract v2`)
    assert.equal(snapshot.stage, 3, `${kind} did not bootstrap stage 3`)
    const missing = requiredCapabilities.filter((capability) => !snapshot.implementedCapabilities.includes(capability))
    assert.deepEqual(
      missing,
      [],
      `${kind} reports frozen preload methods without integrated handlers: ${missing.join(', ')}`
    )
    snapshots[kind] = snapshot
  }
  return snapshots
}

async function assertNegativeIpc(widget) {
  const wrongWindow = await callQuietDesk(widget, ['app', 'bootstrap'], request({ windowKind: 'capture' }))
  assert.equal(wrongWindow.ok, false)
  assert.equal(wrongWindow.error.code, 'FORBIDDEN')

  const invalidTask = await callQuietDesk(widget, ['tasks', 'create'], {
    requestId: 'not-a-uuid',
    idempotencyKey: 'also-not-a-uuid',
    payload: {
      id: 'bad-id',
      title: 'invalid',
      bodyMarkdown: '',
      planDate: null,
      dueDate: null
    }
  })
  assert.equal(invalidTask.ok, false)
  assert.equal(invalidTask.error.code, 'INVALID_REQUEST')
}

async function assertEmptyState(widget) {
  const snapshot = expectOk(
    await callQuietDesk(widget, ['widget', 'getSnapshot'], request({})),
    'empty Widget snapshot'
  )
  assert.deepEqual(snapshot.totals, {
    currentTasks: 0,
    todaySchedules: 0,
    recentNotes: 0,
    completedToday: 0
  })
  assert.deepEqual(snapshot.currentTasks, [])
  assert.deepEqual(snapshot.todaySchedules, [])
  assert.deepEqual(snapshot.recentNotes, [])
  assert.deepEqual(snapshot.completedToday, [])

  for (const selector of [
    widgetSelectors.currentTasks,
    widgetSelectors.todaySchedules,
    widgetSelectors.recentNotes
  ]) {
    const section = widget.locator(selector)
    await section.waitFor({ state: 'visible', timeout: 10_000 })
    await section.locator('.empty-state').waitFor({ state: 'visible' })
    assert.equal(await section.locator('li').count(), 0, `${selector} rendered a fixture item in an empty database`)
  }
  await widget.locator(widgetSelectors.captureEntry).waitFor({ state: 'visible' })
  await widget.locator(widgetSelectors.dateBrowserEntry).waitFor({ state: 'visible' })
}

async function getEntity(page, type, id) {
  return expectOk(
    await callQuietDesk(page, ['library', 'getEntity'], request({ type, id })),
    `get ${type} ${id}`
  )
}

async function getHistory(page, type, id) {
  return expectOk(
    await callQuietDesk(page, ['library', 'getHistory'], request({ type, id })),
    `history ${type} ${id}`
  )
}

async function getDay(page, date) {
  return expectOk(
    await callQuietDesk(page, ['library', 'getDay'], request({ date })),
    `day ${date}`
  )
}

async function createPrimaryTask(capture, yesterday, tomorrow) {
  return expectOk(
    await callQuietDesk(capture, ['tasks', 'create'], request({
      id: TASK_ID,
      title: TASK_TITLE,
      bodyMarkdown: TASK_BODY,
      planDate: yesterday,
      dueDate: tomorrow
    }, { mutation: true })),
    'create Chinese task'
  )
}

async function createBoundarySchedules(capture, currentDate, appTimeZone) {
  const tomorrow = shiftDateOnly(currentDate, 1)
  const timed = expectOk(
    await callQuietDesk(capture, ['schedules', 'create'], request({
      kind: 'timed',
      id: TIMED_SCHEDULE_ID,
      title: '跨午夜计划 23:30–00:30',
      bodyMarkdown: '仍然只是计划，不代表已经参加。',
      startAtUtc: zonedLocalToUtc(currentDate, 23, 30, appTimeZone),
      endAtUtc: zonedLocalToUtc(tomorrow, 0, 30, appTimeZone)
    }, { mutation: true })),
    'create cross-midnight schedule'
  )
  const allDay = expectOk(
    await callQuietDesk(capture, ['schedules', 'create'], request({
      kind: 'all-day',
      id: ALL_DAY_SCHEDULE_ID,
      title: '两日全天安排',
      bodyMarkdown: 'date-only half-open range',
      startDate: currentDate,
      endDateExclusive: shiftDateOnly(currentDate, 2)
    }, { mutation: true })),
    'create all-day schedule'
  )
  return { timed, allDay }
}

async function assertScheduleOverlap(library, currentDate) {
  const before = await getDay(library, shiftDateOnly(currentDate, -1))
  const first = await getDay(library, currentDate)
  const second = await getDay(library, shiftDateOnly(currentDate, 1))
  const after = await getDay(library, shiftDateOnly(currentDate, 2))

  for (const id of [TIMED_SCHEDULE_ID, ALL_DAY_SCHEDULE_ID]) {
    assert.equal(schedulesFor(before).includes(id), false, `${id} leaked into previous day`)
    assert.equal(schedulesFor(first).filter((value) => value === id).length, 1, `${id} missing/duplicated on first day`)
    assert.equal(schedulesFor(second).filter((value) => value === id).length, 1, `${id} missing/duplicated on second day`)
    assert.equal(schedulesFor(after).includes(id), false, `${id} leaked into exclusive end day`)
  }
}

async function assertStorageFailureAndRetry(runtime, task) {
  const capture = runtime.pages.get('capture')
  const widget = runtime.pages.get('widget')
  const databasePath = join(runtime.userData, 'data', 'quietdesk.sqlite3')
  const beforeEvents = await readChangeProbe(widget)
  const nextSequence = Math.max(0, ...beforeEvents.map((event) => event.sequence)) + 1
  const idempotencyKey = crypto.randomUUID()
  const payload = {
    id: TASK_ID,
    expectedRevision: task.revision,
    planDate: runtime.currentDate,
    dueDate: runtime.tomorrow
  }

  const lock = new DatabaseSync(databasePath)
  let failure
  try {
    lock.exec('PRAGMA busy_timeout = 100')
    lock.exec('BEGIN IMMEDIATE')
    failure = await callQuietDesk(
      capture,
      ['tasks', 'reschedule'],
      request(payload, { mutation: true, idempotencyKey })
    )
  } finally {
    try {
      lock.exec('ROLLBACK')
    } finally {
      lock.close()
    }
  }

  assert.equal(failure.ok, false, `SQLite write lock unexpectedly allowed mutation: ${JSON.stringify(failure)}`)
  assert.equal(failure.error.code, 'STORAGE_ERROR')
  assert.equal(failure.error.retryable, true)
  await widget.waitForTimeout(250)
  assert.deepEqual(await readChangeProbe(widget), beforeEvents, 'Failed storage transaction emitted a change event')

  const unchanged = await getEntity(runtime.pages.get('library'), 'task', TASK_ID)
  assert.equal(unchanged.value.revision, task.revision)
  assert.equal(unchanged.value.planDate, runtime.yesterday)
  assert.equal(unchanged.value.dueDate, runtime.tomorrow)

  const retry = expectOk(
    await callQuietDesk(
      capture,
      ['tasks', 'reschedule'],
      request(payload, { mutation: true, idempotencyKey })
    ),
    'retry after SQLite lock release'
  )
  assert.equal(retry.revision, task.revision + 1)
  assert.equal(retry.planDate, runtime.currentDate)
  assert.equal(retry.dueDate, runtime.tomorrow)
  await waitForEntityEvent(widget, { type: 'task', id: TASK_ID, minimumSequence: nextSequence })
  return retry
}

async function seedStressData(capture, dates, timeZone) {
  return await capture.evaluate(async ({ dates: values, timeZone: zone }) => {
    const fail = (label, index, result) => ({ ok: false, label, index, result })
    const tasks = []

    for (let index = 0; index < 160; index += 1) {
      const id = crypto.randomUUID()
      const result = await window.quietDesk.tasks.create({
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: {
          id,
          title: index === 0
            ? '超长条目 / VeryLongArchitectureReviewWithoutConvenientBreakPoints / 中文标点，emoji 🌙✅'
            : `压力任务 ${String(index + 1).padStart(3, '0')} / bulk task`,
          bodyMarkdown: index === 0 ? 'https://example.invalid/a/very/long/path/without/layout/shortcuts' : '',
          planDate: values.currentDate,
          dueDate: index % 3 === 0 ? values.tomorrow : null
        }
      })
      if (!result.ok) return fail('task.create', index, result)
      tasks.push(result.value)
    }

    for (let index = 0; index < 40; index += 1) {
      const task = tasks[index]
      const result = await window.quietDesk.tasks.setCompletion({
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: { id: task.id, expectedRevision: task.revision, action: 'complete' }
      })
      if (!result.ok) return fail('tasks.setCompletion', index, result)
    }

    const startAtUtc = values.stressStartAtUtc
    const endAtUtc = values.stressEndAtUtc
    for (let index = 0; index < 60; index += 1) {
      const result = await window.quietDesk.schedules.create({
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: {
          kind: 'timed',
          id: crypto.randomUUID(),
          title: `安排 ${String(index + 1).padStart(2, '0')} / schedule`,
          bodyMarkdown: `Application time zone: ${zone}`,
          startAtUtc,
          endAtUtc
        }
      })
      if (!result.ok) return fail('schedules.create', index, result)
    }

    for (let index = 0; index < 40; index += 1) {
      const result = await window.quietDesk.notes.create({
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        payload: {
          id: crypto.randomUUID(),
          title: `记录 ${String(index + 1).padStart(2, '0')} / note`,
          bodyMarkdown: index === 0
            ? '长中英混排：ArchitectureReviewWithoutConvenientBreakPoints，emoji 🌿，中文标点。'
            : '真实 SQLite 压力记录'
        }
      })
      if (!result.ok) return fail('notes.create', index, result)
    }

    return {
      ok: true,
      createdTasks: tasks.length,
      completedTasks: 40,
      currentStressTasks: 120,
      schedules: 60,
      notes: 40,
      longTaskId: tasks[0].id
    }
  }, {
    dates: {
      currentDate: dates.currentDate,
      tomorrow: dates.tomorrow,
      stressStartAtUtc: zonedLocalToUtc(dates.currentDate, 9, 0, timeZone),
      stressEndAtUtc: zonedLocalToUtc(dates.currentDate, 10, 0, timeZone)
    },
    timeZone
  })
}

async function assertDenseAndResponsiveWidget(runtime, expectedMinimums) {
  const widget = runtime.pages.get('widget')
  const snapshot = expectOk(
    await callQuietDesk(widget, ['widget', 'getSnapshot'], request({})),
    'dense Widget snapshot'
  )
  assert.ok(snapshot.totals.currentTasks >= expectedMinimums.currentTasks)
  assert.ok(snapshot.totals.completedToday >= expectedMinimums.completedToday)
  assert.ok(snapshot.totals.todaySchedules >= expectedMinimums.todaySchedules)
  assert.ok(snapshot.totals.recentNotes >= expectedMinimums.recentNotes)

  await widget.waitForFunction(({ selector, total }) => {
    const badge = document.querySelector(selector)?.querySelector('.count-badge')
    return Number(badge?.textContent) === total
  }, {
    selector: widgetSelectors.currentTasks,
    total: snapshot.totals.currentTasks
  }, { timeout: 20_000 })

  const section = widget.locator(widgetSelectors.currentTasks)
  await section.waitFor({ state: 'visible' })
  assert.equal(Number(await section.locator('.count-badge').textContent()), snapshot.totals.currentTasks)
  const shownTasks = await widget.locator(widgetSelectors.currentTaskItems).count()
  assert.ok(shownTasks > 0 && shownTasks < snapshot.totals.currentTasks, 'Widget did not cap a dense task list')
  const overflow = widget.locator(widgetSelectors.currentTaskOverflow)
  await overflow.waitFor({ state: 'visible' })
  assert.match(await overflow.textContent(), new RegExp(String(snapshot.totals.currentTasks - shownTasks), 'u'))

  const completed = widget.locator(widgetSelectors.completedToggle)
  await completed.waitFor({ state: 'visible' })
  assert.equal(await completed.evaluate((element) => element.open), false, 'Completed tasks must be folded by default')

  for (const [width, height] of [[320, 240], [480, 420], [720, 720], [437, 386]]) {
    await setWidgetContentSize(runtime.app, width, height)
    await widget.waitForTimeout(100)
    await assertCoreEntriesInViewport(widget)
  }

  const primaryTask = widget.locator(`[data-entity-id="${TASK_ID}"]`)
  await primaryTask.waitFor({ state: 'attached', timeout: 10_000 })
  assert.equal((await primaryTask.textContent()).includes(TASK_TITLE), true, 'Long mixed title was not retained in the DOM')
}

await ensureBuilt()
const testRoot = await makeIsolatedRoot(ROOT_PREFIX)
let runtime
const processIds = []

try {
  runtime = await launchQuietDesk({ userData: testRoot, locale: 'zh-CN' })
  runtime.userData = testRoot
  processIds.push(runtime.runtime.pid)
  await assertSecurityBoundary(runtime)
  const firstBootstrap = await requireStage3Capabilities(runtime)
  await assertNegativeIpc(runtime.pages.get('widget'))
  await assertEmptyState(runtime.pages.get('widget'))
  for (const page of runtime.pages.values()) await installChangeProbe(page)

  const currentDate = firstBootstrap.widget.currentDate
  const yesterday = shiftDateOnly(currentDate, -1)
  const tomorrow = shiftDateOnly(currentDate, 1)
  const createdTask = await createPrimaryTask(runtime.pages.get('capture'), yesterday, tomorrow)
  assert.equal(createdTask.revision, 1)
  assert.equal(createdTask.planDate, yesterday)
  assert.equal(createdTask.dueDate, tomorrow)
  assert.equal(createdTask.completedAtUtc, null)
  await waitForEntityEvent(runtime.pages.get('widget'), { type: 'task', id: TASK_ID })
  await waitForEntityEvent(runtime.pages.get('library'), { type: 'task', id: TASK_ID })
  const firstSnapshot = expectOk(
    await callQuietDesk(runtime.pages.get('widget'), ['widget', 'getSnapshot'], request({})),
    'Widget after cross-window task create'
  )
  assert.equal(firstSnapshot.currentTasks.some((item) => item.task.id === TASK_ID), true)
  await runtime.pages.get('widget').locator(`[data-entity-id="${TASK_ID}"]`).waitFor({ state: 'attached', timeout: 10_000 })

  await closeQuietDesk(runtime)
  runtime = undefined

  runtime = await launchQuietDesk({ userData: testRoot, locale: 'zh-CN' })
  runtime.userData = testRoot
  processIds.push(runtime.runtime.pid)
  assert.notEqual(processIds[1], processIds[0], 'Electron process did not restart')
  const secondBootstrap = await requireStage3Capabilities(runtime)
  assert.equal(secondBootstrap.widget.currentDate, currentDate, 'Application date changed during the restart test')
  for (const page of runtime.pages.values()) await installChangeProbe(page)

  const persisted = await getEntity(runtime.pages.get('library'), 'task', TASK_ID)
  assert.equal(persisted.type, 'task')
  assert.equal(persisted.value.title, TASK_TITLE)
  assert.equal(persisted.value.bodyMarkdown, TASK_BODY)
  assert.equal(persisted.value.planDate, yesterday)
  assert.equal(persisted.value.dueDate, tomorrow)
  assert.equal(persisted.value.revision, 1)

  const yesterdayView = await getDay(runtime.pages.get('library'), yesterday)
  const yesterdayTask = yesterdayView.tasks.find((item) => item.task.id === TASK_ID)
  assert.ok(yesterdayTask, 'Yesterday task disappeared after restart')
  assert.equal(yesterdayTask.task.planDate, yesterday, 'Yesterday task was silently rescheduled')
  assert.equal(yesterdayTask.task.dueDate, tomorrow, 'Due date changed without a command')

  await createBoundarySchedules(runtime.pages.get('capture'), currentDate, secondBootstrap.widget.appTimeZone)
  await assertScheduleOverlap(runtime.pages.get('library'), currentDate)

  const completed = expectOk(
    await callQuietDesk(runtime.pages.get('capture'), ['tasks', 'setCompletion'], request({
      id: TASK_ID,
      expectedRevision: persisted.value.revision,
      action: 'complete'
    }, { mutation: true })),
    'complete task'
  )
  assert.equal(completed.revision, 2)
  assert.ok(completed.completedAtUtc)
  await waitForEntityEvent(runtime.pages.get('widget'), { type: 'task', id: TASK_ID })
  const completionHistory = await getHistory(runtime.pages.get('library'), 'task', TASK_ID)
  assert.deepEqual(completionHistory.map((entry) => entry.operation), ['task.created', 'task.completed'])
  assert.deepEqual(completionHistory.map((entry) => entry.sequence), [...completionHistory.map((entry) => entry.sequence)].sort((a, b) => a - b))

  await closeQuietDesk(runtime)
  runtime = undefined

  runtime = await launchQuietDesk({ userData: testRoot, locale: 'zh-CN' })
  runtime.userData = testRoot
  runtime.currentDate = currentDate
  runtime.yesterday = yesterday
  runtime.tomorrow = tomorrow
  processIds.push(runtime.runtime.pid)
  assert.equal(new Set(processIds).size, 3, 'Each persistence checkpoint must use a distinct Electron process')
  await requireStage3Capabilities(runtime)
  for (const page of runtime.pages.values()) await installChangeProbe(page)

  const completedAfterRestart = await getEntity(runtime.pages.get('library'), 'task', TASK_ID)
  assert.equal(completedAfterRestart.value.revision, 2)
  assert.ok(completedAfterRestart.value.completedAtUtc)
  const completedSnapshot = expectOk(
    await callQuietDesk(runtime.pages.get('widget'), ['widget', 'getSnapshot'], request({})),
    'Widget after completed-task restart'
  )
  assert.equal(completedSnapshot.currentTasks.some((item) => item.task.id === TASK_ID), false)
  assert.equal(completedSnapshot.completedToday.some((task) => task.id === TASK_ID), true)
  assert.deepEqual(
    (await getHistory(runtime.pages.get('library'), 'task', TASK_ID)).map((entry) => entry.operation),
    ['task.created', 'task.completed']
  )

  const reopened = expectOk(
    await callQuietDesk(runtime.pages.get('library'), ['tasks', 'setCompletion'], request({
      id: TASK_ID,
      expectedRevision: completedAfterRestart.value.revision,
      action: 'reopen'
    }, { mutation: true })),
    'reopen task'
  )
  assert.equal(reopened.revision, 3)
  assert.equal(reopened.completedAtUtc, null)
  assert.equal(reopened.planDate, yesterday)
  assert.equal(reopened.dueDate, tomorrow)
  await waitForEntityEvent(runtime.pages.get('widget'), { type: 'task', id: TASK_ID })
  await waitForEntityEvent(runtime.pages.get('capture'), { type: 'task', id: TASK_ID })
  const reopenedSnapshot = expectOk(
    await callQuietDesk(runtime.pages.get('widget'), ['widget', 'getSnapshot'], request({})),
    'Widget after reopen'
  )
  assert.equal(reopenedSnapshot.currentTasks.some((item) => item.task.id === TASK_ID), true)
  assert.equal(reopenedSnapshot.completedToday.some((task) => task.id === TASK_ID), false)
  assert.deepEqual(
    (await getHistory(runtime.pages.get('library'), 'task', TASK_ID)).map((entry) => entry.operation),
    ['task.created', 'task.completed', 'task.reopened']
  )

  const rescheduled = await assertStorageFailureAndRetry(runtime, reopened)
  assert.equal(rescheduled.revision, 4)

  const stress = await seedStressData(
    runtime.pages.get('capture'),
    { currentDate, tomorrow },
    secondBootstrap.widget.appTimeZone
  )
  assert.equal(stress.ok, true, `Stress seed failed: ${JSON.stringify(stress)}`)
  assert.deepEqual(
    {
      createdTasks: stress.createdTasks,
      completedTasks: stress.completedTasks,
      currentStressTasks: stress.currentStressTasks,
      schedules: stress.schedules,
      notes: stress.notes
    },
    { createdTasks: 160, completedTasks: 40, currentStressTasks: 120, schedules: 60, notes: 40 }
  )

  await assertDenseAndResponsiveWidget(runtime, {
    currentTasks: 121,
    completedToday: 40,
    todaySchedules: 62,
    recentNotes: 40
  })

  console.info(`STAGE3_BUSINESS_PASS ${JSON.stringify({
    electron: runtime.runtime.electron,
    node: runtime.runtime.node,
    sqlite: runtime.runtime.sqlite,
    processIds,
    isolatedUserData: testRoot,
    currentDate,
    appTimeZone: secondBootstrap.widget.appTimeZone,
    stress
  })}`)
} catch (error) {
  console.error(`STAGE3_BUSINESS_FAIL ${JSON.stringify({
    isolatedUserData: testRoot,
    processIds,
    message: error instanceof Error ? error.message : String(error)
  })}`)
  throw error
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(testRoot, ROOT_PREFIX)
}
