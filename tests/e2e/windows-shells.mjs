import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { apiAllowlist, installChangeProbe, waitForEntityEvent } from './stage3-harness.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const testRoot = await mkdtemp(join(tmpdir(), 'quietdesk-e2e-'))
let electronApp

async function collectThreeWindows() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const windows = electronApp.windows()
    if (windows.length >= 3) return windows
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Expected three Electron windows, found ${electronApp.windows().length}`)
}

try {
  const environment = {
    ...process.env,
    QUIETDESK_TEST_USER_DATA: testRoot,
    QUIETDESK_FORCE_FALLBACK: '1',
    QUIETDESK_SHOW_ALL_WINDOWS: '1'
  }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL

  electronApp = await electron.launch({
    args: [projectRoot],
    cwd: projectRoot,
    env: environment,
    timeout: 20_000
  })

  const pages = await collectThreeWindows()
  const byKind = new Map()
  for (const page of pages) {
    await page.locator('html[data-window-kind]').waitFor({ state: 'attached', timeout: 10_000 })
    const kind = await page.locator('html[data-window-kind]').getAttribute('data-window-kind')
    byKind.set(kind, page)
  }
  assert.deepEqual([...byKind.keys()].sort(), ['capture', 'library', 'widget'])

  for (const kind of ['widget', 'capture', 'library']) {
    const page = byKind.get(kind)
    assert.ok(page, `Missing ${kind} renderer`)
    await page.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor({ timeout: 10_000 })
    assert.ok((await page.locator('[data-testid="window-title"]').textContent())?.trim())
    const rendererBoundary = await page.evaluate(() => ({
      process: typeof globalThis.process,
      require: typeof globalThis.require,
      Buffer: typeof globalThis.Buffer,
      namespaces: Object.fromEntries(
        Object.entries(window.quietDesk).map(([name, value]) => [name, Object.keys(value).sort()])
      )
    }))
    assert.deepEqual({
      process: rendererBoundary.process,
      require: rendererBoundary.require,
      Buffer: rendererBoundary.Buffer
    }, {
      process: 'undefined',
      require: 'undefined',
      Buffer: 'undefined'
    })
    assert.deepEqual(Object.keys(rendererBoundary.namespaces).sort(), Object.keys(apiAllowlist).sort())
    for (const [namespace, methods] of Object.entries(apiAllowlist)) {
      assert.deepEqual(rendererBoundary.namespaces[namespace], methods)
    }
  }

  const preferences = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    title: window.getTitle(),
    focused: window.isFocused(),
    preferences: window.webContents.getLastWebPreferences()
  })))
  assert.equal(preferences.length, 3)
  for (const item of preferences) {
    assert.equal(item.preferences.contextIsolation, true)
    assert.equal(item.preferences.sandbox, true)
    assert.equal(item.preferences.nodeIntegration, false)
    assert.equal(item.focused, false)
  }

  const widget = byKind.get('widget')
  const forbidden = await widget.evaluate(() => window.quietDesk.app.bootstrap({
    requestId: crypto.randomUUID(),
    payload: { windowKind: 'capture' }
  }))
  assert.equal(forbidden.ok, false)
  assert.equal(forbidden.error.code, 'FORBIDDEN')

  const invalid = await widget.evaluate(() => window.quietDesk.notes.get({
    requestId: 'not-a-uuid',
    payload: { id: 'not-an-id' }
  }))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'INVALID_REQUEST')

  const noteId = '30000000-0000-4000-8000-000000000001'
  for (const page of byKind.values()) await installChangeProbe(page)
  const created = await widget.evaluate((id) => window.quietDesk.notes.create({
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    payload: { id, title: 'E2E / 跨窗口', bodyMarkdown: 'real SQLite update' }
  }), noteId)
  assert.equal(created.ok, true)
  assert.equal(created.value.id, noteId)

  for (const page of byKind.values()) {
    await waitForEntityEvent(page, { type: 'note', id: noteId })
  }

  const capture = byKind.get('capture')
  const readBack = await capture.evaluate((id) => window.quietDesk.notes.get({
    requestId: crypto.randomUUID(),
    payload: { id }
  }), noteId)
  assert.equal(readBack.ok, true)
  assert.equal(readBack.value.bodyMarkdown, 'real SQLite update')

  await widget.locator(`[data-testid="recent-note-item"][data-entity-id="${noteId}"]`)
    .waitFor({ state: 'attached', timeout: 10_000 })

  console.info(`E2E_WINDOWS_SECURITY_PASS ${JSON.stringify({
    windows: [...byKind.keys()].sort(),
    securePreferences: true,
    rendererNodeGlobals: false,
    crossWindowChange: true,
    isolatedUserData: testRoot
  })}`)
} finally {
  await electronApp?.close().catch(() => undefined)
  const resolvedRoot = resolve(testRoot)
  const expectedPrefix = resolve(tmpdir(), 'quietdesk-e2e-')
  if (!resolvedRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolvedRoot}`)
  }
  await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
