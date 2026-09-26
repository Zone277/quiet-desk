import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  bootstrap, callQuietDesk, cleanIsolatedRoot, expectOk, makeIsolatedRoot, request,
  assertSecurityBoundary
} from './stage3-harness.mjs'
import { launchStage6, quitStage6 } from './stage6-runtime.mjs'

const PREFIX = 'quietdesk-stage6-lifecycle-'
const root = await makeIsolatedRoot(PREFIX)
const taskId = randomUUID()
const sentinel = 'QA正文仅入SQLite，不应出现在变更事件 ✅'
let runtime
const evidence = { status: 'NOT_RUN', scope: 'Electron lifecycle; no Windows Shell or IME claim', steps: [] }

async function invoke(kind, namespace, method, payload, mutation = false, key) {
  return await callQuietDesk(runtime.pages.get(kind), [namespace, method],
    request(payload, { mutation, idempotencyKey: key }))
}

async function success(kind, namespace, method, payload, mutation = false, key) {
  return expectOk(await invoke(kind, namespace, method, payload, mutation, key), `${namespace}.${method}`)
}

async function probes() {
  for (const page of runtime.pages.values()) {
    await page.evaluate(() => {
      window.__stage6Unsubscribe?.()
      window.__stage6Events = []
      window.__stage6Unsubscribe = window.quietDesk.changes.subscribe((event) => window.__stage6Events.push(event))
      // Stress the public idempotent disposer: removed listeners must stay silent.
      window.__stage6Cancelled = 0
      for (let index = 0; index < 100; index += 1) {
        const stop = window.quietDesk.changes.subscribe(() => { window.__stage6Cancelled += 1 })
        stop()
        stop()
      }
    })
  }
}

async function eventBarrier(sequence) {
  // Main->renderer sends on the same channel form a FIFO barrier after mutations.
  // Avoid a negative assertion that passes only because delivery has not happened.
  const eventId = randomUUID()
  await runtime.app.evaluate(({ BrowserWindow }, { sequence, eventId }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('quietdesk:v2:changed', {
        eventId, sequence, occurredAtUtc: '2026-09-26T04:00:00.000Z', topics: ['tasks'], entityRefs: []
      })
    }
  }, { sequence, eventId })
  for (const page of runtime.pages.values()) {
    await page.waitForFunction((eventId) => window.__stage6Events.some((event) =>
      event.eventId === eventId), eventId)
  }
}

async function assertEvents(expectedCount, minimumSequence) {
  await eventBarrier(minimumSequence)
  const byKind = {}
  for (const [kind, page] of runtime.pages) {
    const result = await page.evaluate(() => ({
      events: window.__stage6Events.filter((event) => event.entityRefs?.some((ref) => ref.id)),
      cancelled: window.__stage6Cancelled
    }))
    const events = result.events.filter((event) => event.entityRefs.some((ref) => ref.id === taskId))
    assert.equal(events.length, expectedCount, `${kind}: duplicate/missing committed event`)
    assert.equal(result.cancelled, 0, `${kind}: cancelled subscriptions still fired`)
    assert.equal(JSON.stringify(events).includes(sentinel), false, 'change stream leaked body')
    byKind[kind] = events.map((event) => event.sequence)
  }
  assert.deepEqual(byKind.capture, byKind.widget)
  assert.deepEqual(byKind.library, byKind.widget)
  assert.equal(new Set(byKind.widget).size, expectedCount)
  evidence.steps.push({ check: 'change delivery', status: 'PASS', byKind })
}

async function snapshotCounts(current, completed) {
  for (const kind of runtime.pages.keys()) {
    const snapshot = await success(kind, 'widget', 'getSnapshot', {})
    assert.equal(snapshot.currentTasks.filter((item) => item.task.id === taskId).length, current)
    assert.equal(snapshot.completedToday.filter((task) => task.id === taskId).length, completed)
  }
  // Actual renderer refresh, not merely a direct API read.
  const widget = runtime.pages.get('widget')
  await widget.waitForFunction(({ id, current }) => {
    const rows = [...document.querySelectorAll('[data-testid="current-task-item"]')]
    return rows.filter((row) => row.textContent?.includes(id)).length === current
  }, { id: `Stage6 ${taskId}`, current })
  await runtime.pages.get('library').waitForFunction(({ id, count }) => (
    document.querySelectorAll(`[data-testid="library-task-list"] [data-entity-id="${id}"]`).length === count
  ), { id: taskId, count: current + completed })
}

async function unregisteredRenderer() {
  const widget = runtime.pages.get('widget')
  const created = runtime.app.waitForEvent('window')
  const probeId = await runtime.app.evaluate(async ({ BrowserWindow }, preload) => {
    const registered = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('widget.html'))
    const probe = new BrowserWindow({ show: false, webPreferences: {
      preload,
      sandbox: true, contextIsolation: true, nodeIntegration: false
    } })
    await probe.loadURL(registered.webContents.getURL())
    return probe.id
  }, join(runtime.runtime.appPath, 'out', 'preload', 'index.js'))
  const page = await created
  await page.waitForFunction(() => Boolean(window.quietDesk))
  try {
    for (const [path, payload, mutation] of [
      [['app', 'bootstrap'], { windowKind: 'widget' }, false],
      [['widget', 'getSnapshot'], {}, false],
      [['notes', 'create'], { id: randomUUID(), title: 'unauthorized', bodyMarkdown: sentinel }, true]
    ]) {
      const denied = await callQuietDesk(page, path, request(payload, { mutation }))
      assert.equal(denied.ok, false)
      assert.equal(denied.error.code, 'FORBIDDEN', `unregistered ${path.join('.')}`)
    }
  } finally {
    await runtime.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), probeId)
  }
  assert.equal((await bootstrap(widget, 'widget')).dataRevision, 4, 'denied mutation changed revision')
  evidence.steps.push({ check: 'unregistered real sandboxed renderer', status: 'PASS' })
}

try {
  runtime = await launchStage6(root)
  evidence.runtime = runtime.runtime
  await assertSecurityBoundary(runtime)
  assert.equal((await bootstrap(runtime.pages.get('widget'), 'widget')).dataRevision, 0)
  await probes()
  let task = await success('capture', 'tasks', 'create', {
    id: taskId, title: `Stage6 ${taskId}`, bodyMarkdown: sentinel, planDate: '2026-09-26', dueDate: null
  }, true)
  await assertEvents(1, 1)
  await snapshotCounts(1, 0)
  const completionKey = randomUUID()
  const completion = { id: taskId, expectedRevision: task.revision, action: 'complete' }
  task = await success('widget', 'tasks', 'setCompletion', completion, true, completionKey)
  assert.deepEqual(await success('widget', 'tasks', 'setCompletion', completion, true, completionKey), task)
  await assertEvents(2, 2)
  await snapshotCounts(0, 1)
  const conflict = await invoke('capture', 'tasks', 'setCompletion', completion, true)
  assert.equal(conflict.error?.code, 'CONFLICT')
  const trashed = await success('library', 'entities', 'trash', {
    entity: { type: 'task', id: taskId }, expectedRevision: task.revision
  }, true)
  await snapshotCounts(0, 0)
  const restored = await success('library', 'entities', 'restore', {
    entity: { type: 'task', id: taskId }, expectedRevision: trashed.value.revision
  }, true)
  assert.equal(restored.value.bodyMarkdown, sentinel)
  await assertEvents(4, 4)
  await snapshotCounts(0, 1)
  await unregisteredRenderer()

  // Repeated context subscription cancellation and renderer reload.
  const library = runtime.pages.get('library')
  await library.evaluate(() => {
    window.__stage6Contexts = []
    window.__stage6ContextCancelled = 0
    window.quietDesk.windows.subscribeContext((context) => window.__stage6Contexts.push(context))
    for (let index = 0; index < 100; index += 1) {
      const stop = window.quietDesk.windows.subscribeContext(() => { window.__stage6ContextCancelled += 1 })
      stop(); stop()
    }
  })
  for (let index = 0; index < 10; index += 1) {
    await success('widget', 'windows', 'show', { target: 'library', selectedDate: '2026-09-26' })
  }
  await library.waitForFunction(() => window.__stage6Contexts.length >= 10)
  const contexts = await library.evaluate(() => ({ count: window.__stage6Contexts.length, cancelled: window.__stage6ContextCancelled }))
  assert.deepEqual(contexts, { count: 10, cancelled: 0 })
  for (let index = 0; index < 3; index += 1) {
    await library.reload()
    await library.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor()
    assert.equal((await bootstrap(library, 'library')).dataRevision, 4)
  }
  await probes()
  await success('widget', 'tasks', 'setCompletion', {
    id: taskId, expectedRevision: restored.value.revision, action: 'reopen'
  }, true)
  await assertEvents(1, 5)
  await snapshotCounts(1, 0)
  evidence.steps.push({ check: '100 context disposers; 10 activations; 3 reloads then mutation and renderer refresh', status: 'PASS' })

  const before = await runtime.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    id: window.id, url: window.webContents.getURL()
  })))
  for (const kind of ['capture', 'library', 'widget']) {
    const state = await runtime.app.evaluate(({ BrowserWindow }, kind) => {
      const window = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes(`${kind}.html`))
      window.showInactive()
      window.close()
      return { id: window.id, destroyed: window.isDestroyed(), visible: !window.isDestroyed() && window.isVisible() }
    }, kind)
    assert.equal(state.destroyed, false, `${kind}: ordinary close destroyed resident window`)
    assert.equal(state.visible, false, `${kind}: close did not hide`)
  }
  const after = await runtime.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    id: window.id, url: window.webContents.getURL()
  })))
  assert.deepEqual(after, before, 'close must retain all window identities')
  await success('widget', 'windows', 'show', { target: 'library', selectedDate: '2026-09-26' })
  await success('widget', 'windows', 'show', { target: 'capture' })
  const shortcut = await success('library', 'shortcuts', 'get', {})
  // Observe after product before-quit cleanup has run; only this test process exits.
  await runtime.app.evaluate(({ app, globalShortcut }, accelerator) => {
    app.on('will-quit', () => {
      console.info(`STAGE6_QUIT_SHORTCUT ${JSON.stringify({ registered: globalShortcut.isRegistered(accelerator) })}`)
    })
  }, shortcut.accelerator)
  let output = ''
  runtime.app.process().stdout.on('data', (chunk) => { output += chunk.toString() })
  await quitStage6(runtime)
  runtime = undefined
  assert.match(output, /STAGE6_QUIT_SHORTCUT \{"registered":false\}/u)
  const database = new DatabaseSync(join(root, 'data', 'quietdesk.sqlite3'), { readOnly: true })
  try {
    assert.deepEqual(database.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check), ['ok'])
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(database.prepare('SELECT body_markdown FROM tasks WHERE id = ?').get(taskId).body_markdown, sentinel)
    assert.equal(database.prepare('SELECT count(*) AS n FROM change_events').get().n, 5)
  } finally { database.close() }
  runtime = await launchStage6(root)
  assert.notEqual(runtime.runtime.pid, evidence.runtime.pid)
  assert.equal((await bootstrap(runtime.pages.get('widget'), 'widget')).dataRevision, 5)
  await snapshotCounts(1, 0)
  evidence.steps.push({ check: 'close/hide identities; app.quit; SQLite integrity and restart', status: 'PASS' })
  await quitStage6(runtime)
  runtime = undefined
  evidence.status = 'PASS'
  console.info(`STAGE6_LIFECYCLE_PASS ${JSON.stringify(evidence)}`)
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error = error.stack || String(error)
  console.error(`STAGE6_LIFECYCLE_FAIL ${JSON.stringify(evidence)}`)
  throw error
} finally {
  if (runtime) await quitStage6(runtime)
  await cleanIsolatedRoot(root, PREFIX)
}
