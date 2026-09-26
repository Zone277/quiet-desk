import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import {
  assertSecurityBoundary, bootstrap, callQuietDesk, cleanIsolatedRoot, expectOk, makeIsolatedRoot, request
} from './stage3-harness.mjs'
import { launchStage6, quitStage6 } from './stage6-runtime.mjs'

// Complement Lead's release smoke with critical IPC denial; do not duplicate
// SQLite/restart/metrics/offline smoke. A portable wrapper is tested by Lead.
const executablePath = process.argv[2]
assert.ok(executablePath && /\.exe$/iu.test(executablePath),
  'Usage: node tests/e2e/stage6-release.mjs "<absolute current packaged QuietDesk.exe>"')
assert.equal(resolve(executablePath), executablePath, 'use an absolute reviewed artifact path')
const PREFIX = 'quietdesk-stage6-release-ipc-'
const root = await makeIsolatedRoot(PREFIX)
let runtime
const evidence = { status: 'NOT_RUN', executablePath, scope: 'packaged critical IPC; portable/OS Shell/IME NOT_RUN', denied: [] }

async function denied(page, path, payload, code, mutation = false) {
  const input = request(payload, { mutation })
  const result = await callQuietDesk(page, path, input)
  assert.equal(result.ok, false, `${path.join('.')} unexpectedly authorized`)
  assert.equal(result.requestId, input.requestId, 'request correlation lost')
  assert.equal(result.error.code, code)
  assert.equal('stack' in result.error, false, 'error leaked a main-process stack')
  evidence.denied.push({ method: path.join('.'), code })
}

try {
  runtime = await launchStage6(root, { executablePath })
  evidence.runtime = runtime.runtime
  assert.equal(runtime.runtime.platform, 'win32')
  assert.equal(runtime.runtime.packaged, true)
  await assertSecurityBoundary(runtime)
  const widget = runtime.pages.get('widget')
  const capture = runtime.pages.get('capture')
  const library = runtime.pages.get('library')
  const revision = (await bootstrap(widget, 'widget')).dataRevision
  await denied(widget, ['app', 'bootstrap'], { windowKind: 'library' }, 'FORBIDDEN')
  await denied(capture, ['windows', 'show'], { target: 'library' }, 'FORBIDDEN')
  await denied(capture, ['windows', 'hide'], { target: 'library' }, 'FORBIDDEN')
  for (const page of [widget, capture]) {
    for (const method of ['get', 'export']) {
      await denied(page, ['dailyLogs', method], { date: '2026-09-26' }, 'FORBIDDEN')
    }
    await denied(page, ['dailyLogs', 'saveManual'], {
      date: '2026-09-26', expectedRevision: 0, manualMarkdown: 'denied'
    }, 'FORBIDDEN', true)
  }
  await denied(library, ['dailyLogs', 'export'], {
    date: '2026-09-26', filePath: resolve(root, 'renderer-selected.md')
  }, 'INVALID_REQUEST')
  await denied(capture, ['notes', 'create'], {
    id: randomUUID(), title: 'SQL/path injection', bodyMarkdown: 'do not save',
    sql: 'DROP TABLE notes', filePath: resolve(root, 'arbitrary.sqlite3')
  }, 'INVALID_REQUEST', true)
  for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,unsafe', '../relative', 'quietdesk:execute']) {
    await denied(library, ['links', 'openExternal'], { url }, 'INVALID_REQUEST')
  }
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
  const probe = await created
  await probe.waitForFunction(() => Boolean(window.quietDesk))
  try {
    await denied(probe, ['app', 'bootstrap'], { windowKind: 'widget' }, 'FORBIDDEN')
    await denied(probe, ['widget', 'getSnapshot'], {}, 'FORBIDDEN')
    await denied(probe, ['notes', 'create'], {
      id: randomUUID(), title: 'unauthorized', bodyMarkdown: 'must never persist'
    }, 'FORBIDDEN', true)
  } finally {
    await runtime.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), probeId)
  }
  assert.equal((await bootstrap(widget, 'widget')).dataRevision, revision, 'denied operations changed persistent revision')
  const snapshot = expectOk(await callQuietDesk(widget, ['widget', 'getSnapshot'], request({})), 'final snapshot')
  assert.equal(snapshot.totals.recentNotes, 0, 'denied note was persisted')
  await quitStage6(runtime)
  runtime = undefined
  evidence.status = 'PASS'
  console.info(`STAGE6_RELEASE_IPC_PASS ${JSON.stringify(evidence)}`)
} catch (error) {
  evidence.status = 'FAIL'
  console.error(`STAGE6_RELEASE_IPC_FAIL ${JSON.stringify(evidence)}`)
  throw error
} finally {
  if (runtime) await quitStage6(runtime)
  await cleanIsolatedRoot(root, PREFIX)
}
