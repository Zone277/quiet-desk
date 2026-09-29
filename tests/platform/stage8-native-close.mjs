import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const workspace = resolve(import.meta.dirname, '../..')
const release = process.argv.includes('--release')
const executablePath = release ? join(workspace, 'release', 'win-unpacked', 'QuietDesk.exe') : undefined
const root = await mkdtemp(join(workspace, 'test-results', 'stage8', 'native-close-'))
const userData = join(root, 'userData')
await mkdir(userData)
const helper = join(workspace, 'native', 'bin', 'windows_desktop_host.exe')
const env = { ...process.env, QUIETDESK_TEST_USER_DATA: userData }
for (const name of ['QUIETDESK_FORCE_FALLBACK', 'ELECTRON_RENDERER_URL', 'QUIETDESK_AUTO_QUIT_MS',
  'QUIETDESK_SHOW_ALL_WINDOWS', 'QUIETDESK_STORAGE_SMOKE_MODE']) delete env[name]

let app
const report = { root, userData, release, steps: [] }
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [workspace] }),
    cwd: userData, env, timeout: 30_000
  })
  const widget = await app.firstWindow({ timeout: 15_000 })
  await widget.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor({ timeout: 15_000 })
  const before = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('widget.html'))
    assertWindow(window)
    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString()
    return { pid: process.pid, handle, visible: window.isVisible(), destroyed: window.isDestroyed() }
    function assertWindow(value) { if (!value) throw new Error('Widget window missing') }
  })
  assert.equal(before.visible, true)
  let native = spawnSync(helper, ['inspect', before.handle], { encoding: 'utf8' })
  assert.equal(native.status, 0, native.stderr || native.stdout)
  assert.equal(JSON.parse(native.stdout).parentClass, 'WorkerW')
  report.steps.push({ action: 'before close', ...before, parentClass: 'WorkerW' })

  const closed = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('widget.html'))
    window.close()
    return { visible: window.isVisible(), destroyed: window.isDestroyed() }
  })
  assert.deepEqual(closed, { visible: false, destroyed: false })
  native = spawnSync(helper, ['inspect', before.handle], { encoding: 'utf8' })
  assert.equal(native.status, 0, native.stderr || native.stdout)
  report.steps.push({ action: 'after ordinary close', ...closed,
    nativeParentClass: JSON.parse(native.stdout).parentClass })

  const process = app.process()
  let quitErrors = ''
  process.stderr?.on('data', (chunk) => { quitErrors += chunk.toString() })
  const exited = app.waitForEvent('close', { timeout: 15_000 })
  await app.evaluate(({ app }) => { app.quit() }).catch((error) => {
    if (!/closed|destroyed|Target page/iu.test(String(error))) throw error
  })
  await exited
  assert.equal(process.exitCode, 0)
  assert.doesNotMatch(quitErrors, /QUIETDESK_SHUTDOWN_ERROR|Desktop host redraw failed/u)
  app = undefined
  native = spawnSync(helper, ['inspect', before.handle], { encoding: 'utf8' })
  assert.equal(native.status, 1, native.stderr || native.stdout)
  assert.match(native.stdout, /not a live window/u)
  report.steps.push({ action: 'after app.quit', exitCode: process.exitCode,
    hwndGone: true, shutdownErrors: false })
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.error = error.stack ?? String(error)
  throw error
} finally {
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`STAGE8_NATIVE_CLOSE ${JSON.stringify({ root, status: report.status, steps: report.steps, error: report.error })}`)
  if (app) await app.close().catch(() => undefined)
}
