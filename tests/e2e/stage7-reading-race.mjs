import assert from 'node:assert/strict'
import { bootstrap, callQuietDesk, cleanIsolatedRoot, closeQuietDesk, expectOk,
  launchQuietDesk, makeIsolatedRoot, request } from './stage3-harness.mjs'

// Electron 44 diagnostic-only handler gate: hold a real service response, never
// substitute a fixture or database. This private harness is not product IPC.
const mode = process.argv[2] ?? 'order'
const prefix = 'quietdesk-stage7-reading-'
const root = await makeIsolatedRoot(prefix)
let runtime
try {
  runtime = await launchQuietDesk({ userData: root })
  const library = runtime.pages.get('library')
  const capture = runtime.pages.get('capture')
  await bootstrap(library, 'library')
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [index, id] of ids.entries()) {
    expectOk(await callQuietDesk(library, ['notes', 'create'], request({ id,
      title: `Race note ${index}`, bodyMarkdown: `Unique detail ${index}` }, { mutation: true })), 'create note')
  }
  const detail = library.locator('.detail-column')
  if (mode === 'capture') {
    const editor = capture.getByTestId('capture-body')
    await editor.fill('old persisted r1')
    await capture.locator('[data-testid="draft-save-state"][data-state="saved"]').waitFor()
    await runtime.app.evaluate(({ ipcMain }) => {
      const channel = 'quietdesk:v2:drafts:get'
      const original = ipcMain._invokeHandlers.get(channel)
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        const value = await original(event, request)
        if (!globalThis.stage7Held) {
          globalThis.stage7Held = true
          await new Promise(resolve => { globalThis.stage7Release = resolve })
        }
        return value
      })
    })
    expectOk(await callQuietDesk(library, ['settings', 'updateAppearance'], request({ locale: 'en-US' }, { mutation: true })), 'locale change')
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await runtime.app.evaluate(() => Boolean(globalThis.stage7Held))) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(await runtime.app.evaluate(() => Boolean(globalThis.stage7Held)), true)
    await editor.fill('最新中文 / newest persisted r2')
    await capture.locator('[data-testid="draft-save-state"][data-state="saved"]').waitFor()
    await runtime.app.evaluate(() => globalThis.stage7Release())
    await capture.waitForTimeout(300)
    assert.equal(await editor.inputValue(), '最新中文 / newest persisted r2', 'Old read overwrote newer saved form')
    const draft = expectOk(await callQuietDesk(capture, ['drafts', 'get'], request({ id: '10000000-0000-4000-8000-000000000001' })), 'real draft')
    assert.equal(draft.payload.bodyMarkdown, '最新中文 / newest persisted r2')
  } else if (mode === 'order') {
    await runtime.app.evaluate(({ ipcMain }, id) => {
      const channel = 'quietdesk:v2:entities:get'
      const original = ipcMain._invokeHandlers.get(channel)
      if (typeof original !== 'function') throw new Error('Selected Electron diagnostic handler missing')
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, request) => {
        const value = await original(event, request)
        if (request.payload.id === id && !globalThis.stage7Held) {
          globalThis.stage7Held = true
          await new Promise(resolve => { globalThis.stage7Release = resolve })
        }
        return value
      })
    }, ids[0])
    await library.locator(`[data-entity-id="${ids[0]}"]`).click()
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await runtime.app.evaluate(() => Boolean(globalThis.stage7Held))) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(await runtime.app.evaluate(() => Boolean(globalThis.stage7Held)), true)
    await library.locator(`[data-entity-id="${ids[1]}"]`).click()
    await detail.getByText('Unique detail 1', { exact: true }).waitFor()
    await runtime.app.evaluate(() => globalThis.stage7Release())
    await library.waitForTimeout(300)
    assert.equal(await detail.getByText('Unique detail 1', { exact: true }).count(), 1,
      'Late detail A overwrote most recently selected B')
  } else if (mode === 'delete') {
    await library.locator(`[data-entity-id="${ids[0]}"]`).click()
    await detail.getByText('Unique detail 0', { exact: true }).waitFor()
    expectOk(await callQuietDesk(capture, ['entities', 'trash'], request({
      entity: { type: 'note', id: ids[0] }, expectedRevision: 1
    }, { mutation: true })), 'cross-window delete')
    await library.locator(`[data-entity-id="${ids[0]}"]`).waitFor({ state: 'detached' })
    await library.waitForTimeout(300)
    assert.equal(await detail.getByText('Unique detail 0', { exact: true }).count(), 0,
      'Cross-window deletion left managed body in the selected reader')
  } else throw new Error(`Unsupported diagnostic ${mode}`)
  console.info(`STAGE7_READING_${mode.toUpperCase()}_PASS`)
} finally {
  if (runtime) await runtime.app.evaluate(() => globalThis.stage7Release?.()).catch(() => {})
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(root, prefix)
}
