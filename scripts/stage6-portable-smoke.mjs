import assert from 'node:assert/strict'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const root = resolve('test-results/stage6/便携 启动')
await mkdir(root, { recursive: true })
const exe = join(root, 'QuietDesk 中文 portable.exe')
await copyFile(resolve('release/QuietDesk 0.1.0.exe'), exe)
const data = join(root, `独立 数据 ${Date.now()}`)
const env = { ...process.env, QUIETDESK_TEST_USER_DATA: data, QUIETDESK_SHOW_ALL_WINDOWS: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.QUIETDESK_FORCE_FALLBACK
let app, browser, exited
const report = { status: 'FAIL', executable: exe, data, method: 'portable launcher + loopback renderer CDP; isolated auto-quit', runs: [] }
const id = crypto.randomUUID()
async function start() {
  const reservation = createServer()
  await new Promise(done => reservation.listen(0, '127.0.0.1', done))
  const port = reservation.address().port
  await new Promise(done => reservation.close(done))
  app = spawn(exe, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: root, env: { ...env, QUIETDESK_AUTO_QUIT_MS: '20000' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  exited = new Promise((done, reject) => { app.once('error', reject); app.once('exit', done) })
  const connectionDeadline = Date.now() + 15000
  while (Date.now() < connectionDeadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break }
    catch { await new Promise(done => setTimeout(done, 200)) }
  }
  assert.ok(browser, 'Portable CDP renderer not available')
  const pages = new Map()
  const deadline = Date.now() + 25000
  while (pages.size < 3 && Date.now() < deadline) {
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      const kind = await page.locator('html').getAttribute('data-window-kind').catch(() => null)
      if (kind) pages.set(kind, page)
    }
    if (pages.size < 3) await new Promise(done => setTimeout(done, 100))
  }
  assert.equal(pages.size, 3)
  for (const page of pages.values()) {
    await page.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor()
    assert.ok(page.url().startsWith('file:'))
  }
  const runtime = { launcherPid: app.pid, userAgent: await pages.get('widget').evaluate(() => navigator.userAgent) }
  assert.match(runtime.userAgent, /Electron\/44\.4\.3/u)
  await pages.get('widget').waitForFunction(async () => (await window.quietDeskDesktopSpike.getStatus()).attached,
    undefined, { timeout: 15000 })
  runtime.host = await pages.get('widget').evaluate(() => window.quietDeskDesktopSpike.getStatus())
  assert.equal(runtime.host.native.bridge, 'win32-helper')
  report.runs.push(runtime)
  return pages
}
try {
  let pages = await start()
  const snapshot = await pages.get('widget').evaluate(() => window.quietDesk.widget.getSnapshot({ requestId: crypto.randomUUID(), payload: {} }))
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.value.totals.recentNotes, 0)
  const created = await pages.get('library').evaluate(async id => window.quietDesk.notes.create({
    requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), payload: { id, title: '便携 中文', bodyMarkdown: 'portable 持久化' }
  }), id)
  assert.equal(created.ok, true)
  assert.equal(await exited, 0)
  await browser.close().catch(() => undefined); browser = undefined; app = undefined
  pages = await start()
  const restored = await pages.get('library').evaluate(id => window.quietDesk.notes.get({ requestId: crypto.randomUUID(), payload: { id } }), id)
  assert.equal(restored.ok, true)
  assert.equal(restored.value.bodyMarkdown, 'portable 持久化')
  assert.notEqual(report.runs[0].launcherPid, report.runs[1].launcherPid)
  assert.equal(await exited, 0)
  await browser.close().catch(() => undefined); browser = undefined; app = undefined
  report.status = 'PASS'
  console.info(`STAGE6_PORTABLE_PASS ${JSON.stringify({ exe, data, launcherPids: report.runs.map(run => run.launcherPid) })}`)
} catch (error) { report.error = error.stack || String(error); throw error }
finally {
  if (app) await exited.catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
}
