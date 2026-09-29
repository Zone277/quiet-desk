import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const workspace = resolve(import.meta.dirname, '../..')
const release = process.argv.includes('--release')
const visibleQuit = process.argv.includes('--visible-quit')
const executablePath = release ? join(workspace, 'release', 'win-unpacked', 'QuietDesk.exe') : undefined
const root = await mkdtemp(join(workspace, 'test-results', 'stage8', 'native-close-'))
const userData = join(root, 'userData')
await mkdir(userData)
const helper = release
  ? join(workspace, 'release', 'win-unpacked', 'resources', 'native', 'windows_desktop_host.exe')
  : join(workspace, 'native', 'bin', 'windows_desktop_host.exe')
const stateHelper = join(root, 'wallpaper-state.exe')
const compile = spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  ['/nologo', '/target:exe', '/platform:x64', '/r:System.Web.Extensions.dll', `/out:${stateHelper}`,
    join(workspace, 'tests', 'platform', 'stage8-wallpaper-state.cs')], { encoding: 'utf8' })
assert.equal(compile.status, 0, compile.stderr || compile.stdout)
function wallpaperState() {
  const result = spawnSync(stateHelper, [], { encoding: 'utf8', timeout: 10_000 })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}
const wallpaperBefore = wallpaperState()
const env = { ...process.env, QUIETDESK_TEST_USER_DATA: userData }
for (const name of ['QUIETDESK_FORCE_FALLBACK', 'ELECTRON_RENDERER_URL', 'QUIETDESK_AUTO_QUIT_MS',
  'QUIETDESK_SHOW_ALL_WINDOWS', 'QUIETDESK_STORAGE_SMOKE_MODE']) delete env[name]

let app
const report = { root, userData, release, visibleQuit, helper, wallpaperBefore,
  visualStatus: 'NOT_RUN', steps: [] }
let runtimeStdout = ''
try {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [workspace] }),
    cwd: userData, env, timeout: 30_000
  })
  app.process().stdout?.on('data', (chunk) => { runtimeStdout += chunk.toString() })
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

  if (!visibleQuit) {
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
  }

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
  const detachLine = runtimeStdout.match(/^QUIETDESK_DESKTOP_DETACH (.+)$/m)
  assert.ok(detachLine, 'Missing native detach evidence')
  report.detach = JSON.parse(detachLine[1])
  assert.equal(report.detach.success, true)
  assert.equal(report.detach.parentHandle, '0x0')
  assert.equal(Number.parseInt(report.detach.styleHex, 16) & 0x10000000, 0, 'Detach unexpectedly re-shows Widget')
  assert.equal(report.detach.wallpaperRefresh, 'reloaded-from-settings',
    'This legacy-host regression requires the real wallpaper-surface reload path')
  report.wallpaperAfter = wallpaperState()
  const { activeWallpaperSha256: beforeImage, ...beforeSettings } = wallpaperBefore
  const { activeWallpaperSha256: afterImage, ...afterSettings } = report.wallpaperAfter
  assert.deepEqual(afterSettings, beforeSettings, 'Desktop wallpaper configuration changed on exit')
  if ((wallpaperBefore.slideshowStatus & 2) === 0) {
    assert.equal(afterImage, beforeImage, 'Static wallpaper changed on exit')
  }
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
