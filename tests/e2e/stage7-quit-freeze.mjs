import assert from 'node:assert/strict'
import { cleanIsolatedRoot, launchQuietDesk, makeIsolatedRoot } from './stage3-harness.mjs'

const prefix = 'quietdesk-stage7-quit-freeze-'
const root = await makeIsolatedRoot(prefix)
let runtime
let exited
try {
  runtime = await launchQuietDesk({ userData: root })
  const capture = runtime.pages.get('capture'), library = runtime.pages.get('library')
  await library.evaluate(() => {
    window.quietDesk.app.subscribeQuitPreparation(() => new Promise(resolve => { window.stage7ReleaseQuit = resolve }))
  })
  await runtime.app.evaluate(({ ipcMain, BrowserWindow }) => {
    const capture = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture.html'))
    ipcMain.on('quietdesk:v4:app:quit-prepared', (event, answer) => {
      if (event.sender.id === capture.webContents.id && answer.ready) globalThis.stage7CaptureReady = true
    })
  })
  const editor = capture.getByTestId('capture-body')
  const process = runtime.app.process()
  await editor.fill('Frozen until all windows agree / 退出锁')
  exited = runtime.app.waitForEvent('close', { timeout: 15_000 })
  await runtime.app.evaluate(({ app }) => app.quit())
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await runtime.app.evaluate(() => Boolean(globalThis.stage7CaptureReady))) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(await runtime.app.evaluate(() => Boolean(globalThis.stage7CaptureReady)), true)
  assert.equal(await library.evaluate(() => document.documentElement.inert), true,
    'The entire window must stay frozen, including newly mounted edit controls')
  assert.equal(await editor.isDisabled(), true, 'Capture accepted editing after ready while Library was still pending')
  assert.equal(await library.getByTestId('daily-log-manual-input').isDisabled(), true,
    'Library accepted new handwriting after its own flush')
  await library.evaluate(() => window.stage7ReleaseQuit(true))
  await exited
  assert.equal(process.exitCode, 0)
  runtime = undefined
  console.info('STAGE7_QUIT_FREEZE_PASS')
} finally {
  if (runtime) {
    await runtime.pages.get('library').evaluate(() => window.stage7ReleaseQuit?.(true)).catch(() => {})
    if (exited) await exited
    else await runtime.app.close()
  }
  await cleanIsolatedRoot(root, prefix)
}
