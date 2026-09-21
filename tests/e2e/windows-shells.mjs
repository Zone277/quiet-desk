import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

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
    assert.equal(await page.locator('[data-testid="window-title"]').textContent(), kind[0].toUpperCase() + kind.slice(1))
    const rendererBoundary = await page.evaluate(() => ({
      process: typeof globalThis.process,
      require: typeof globalThis.require,
      Buffer: typeof globalThis.Buffer,
      api: Object.keys(window.quietDesk).sort(),
      app: Object.keys(window.quietDesk.app).sort(),
      notes: Object.keys(window.quietDesk.notes).sort(),
      changes: Object.keys(window.quietDesk.changes).sort()
    }))
    assert.deepEqual(rendererBoundary, {
      process: 'undefined',
      require: 'undefined',
      Buffer: 'undefined',
      api: ['app', 'changes', 'notes'],
      app: ['bootstrap'],
      notes: ['create', 'get'],
      changes: ['subscribe']
    })
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
  const created = await widget.evaluate((id) => window.quietDesk.notes.create({
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    payload: { id, title: 'E2E / 跨窗口', bodyMarkdown: 'real SQLite update' }
  }), noteId)
  assert.equal(created.ok, true)
  assert.equal(created.value.id, noteId)

  for (const page of byKind.values()) {
    await page.waitForFunction(() => document.querySelector('[data-testid="bootstrap-state"]')?.getAttribute('data-revision') === '1', undefined, { timeout: 10_000 })
  }

  const capture = byKind.get('capture')
  const readBack = await capture.evaluate((id) => window.quietDesk.notes.get({
    requestId: crypto.randomUUID(),
    payload: { id }
  }), noteId)
  assert.equal(readBack.ok, true)
  assert.equal(readBack.value.bodyMarkdown, 'real SQLite update')

  const interaction = widget.locator('[data-testid="interaction-target"]')
  await interaction.click()
  assert.match(await interaction.textContent(), /1/u)

  console.info(`E2E_S2_WINDOWS_PASS ${JSON.stringify({
    windows: [...byKind.keys()].sort(),
    securePreferences: true,
    rendererNodeGlobals: false,
    crossWindowRevision: 1,
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
