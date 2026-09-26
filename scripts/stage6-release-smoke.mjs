import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { cpus, totalmem, release } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const root = resolve('test-results/stage6/发布 验证')
const executableDirectory = join(root, '应用 含空格')
const data = join(root, `隔离 数据 ${Date.now()}`)
await mkdir(root, { recursive: true })
await cp(resolve('release/win-unpacked'), executableDirectory, { recursive: true })
const exe = join(executableDirectory, 'QuietDesk.exe')
const noteId = crypto.randomUUID()
const mutationKey = crypto.randomUUID()
let application
const report = { status: 'FAIL', executable: exe, userData: data, runs: [], offlineScope: 'Chromium network denied, no dev server; OS adapter disconnect NOT_RUN' }
function processSample() {
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:QD_MEASURE_ROOT, [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object Id, ProcessName, WorkingSet64, CPU, Path) | ConvertTo-Json -Compress"],
    { windowsHide: true, encoding: 'utf8', env: { ...process.env, QD_MEASURE_ROOT: executableDirectory } })
  const value = JSON.parse(result || '[]')
  return { atMs: performance.now(), processes: Array.isArray(value) ? value : [value] }
}
async function start() {
  const env = { ...process.env, QUIETDESK_TEST_USER_DATA: data, QUIETDESK_SHOW_ALL_WINDOWS: '1',
    ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/should-not-load', QUIETDESK_TEST_FAIL_NEXT_CAPTURE_SUBMIT: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.QUIETDESK_FORCE_FALLBACK
  const began = performance.now()
  application = await electron.launch({ executablePath: exe, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'], cwd: root, env, timeout: 45000 })
  let output = ''
  for (const stream of [application.process().stdout, application.process().stderr]) stream?.on('data', chunk => { output += chunk.toString() })
  await application.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }))
  })
  const deadline = Date.now() + 20000
  const pages = new Map()
  while (pages.size < 3 && Date.now() < deadline) {
    for (const page of application.windows()) {
      const kind = await page.locator('html').getAttribute('data-window-kind').catch(() => null)
      if (kind) pages.set(kind, page)
    }
    if (pages.size < 3) await new Promise(done => setTimeout(done, 100))
  }
  assert.equal(pages.size, 3)
  for (const page of pages.values()) {
    await page.context().setOffline(true)
    await page.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor({ timeout: 15000 })
    assert.ok(page.url().startsWith('file:'), `Release loaded a server: ${page.url()}`)
  }
  const runtime = await application.evaluate(({ app, screen }) => ({
    packaged: app.isPackaged, userData: app.getPath('userData'), appData: app.getPath('appData'), name: app.getName(), pid: process.pid,
    electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite,
    resources: process.resourcesPath, displays: screen.getAllDisplays().map(display => ({ bounds: display.bounds, scaleFactor: display.scaleFactor }))
  }))
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.userData, data)
  report.runs.push({ ...runtime, launchToThreeReadyMs: performance.now() - began })
  return { pages, output: () => output }
}
async function invoke(page, namespace, method, payload, key) {
  return await page.evaluate(async ({ namespace, method, payload, key }) => {
    const result = await window.quietDesk[namespace][method]({ requestId: crypto.randomUUID(), ...(key ? { idempotencyKey: key } : {}), payload })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    return result.value
  }, { namespace, method, payload, key })
}
try {
  const first = await start()
  const library = first.pages.get('library')
  const bootstrap = await invoke(library, 'app', 'bootstrap', { windowKind: 'library' })
  report.applicationTimeZone = bootstrap.appTimeZone
  const initial = await invoke(first.pages.get('widget'), 'widget', 'getSnapshot', {})
  assert.equal(initial.totals.currentTasks + initial.totals.todaySchedules + initial.totals.recentNotes + initial.totals.completedToday, 0, 'Ordinary empty release inserted demo data')
  const note = await invoke(library, 'notes', 'create', { id: noteId, title: '发布 中文 persistence', bodyMarkdown: '# offline\n\nEnglish 与中文 🌙\n\n```ts\nconst release = true\n```' }, mutationKey)
  assert.equal(note.id, noteId)
  const log = await invoke(library, 'dailyLogs', 'get', { date: bootstrap.currentDate })
  const manual = await invoke(library, 'dailyLogs', 'saveManual', {
    date: bootstrap.currentDate, expectedRevision: log.manualRevision, manualMarkdown: '迁移 hand-written ✅'
  }, crypto.randomUUID())
  await first.pages.get('widget').waitForFunction(async () => (await window.quietDeskDesktopSpike.getStatus()).attached,
    undefined, { timeout: 15000 })
  report.host = await first.pages.get('widget').evaluate(() => window.quietDeskDesktopSpike.getStatus())
  assert.equal(report.host.native.bridge, 'win32-helper', 'Release depended on Python or missing helper')
  assert.equal(report.host.attached, true, 'Release native helper did not attach')
  for (const [kind, page] of first.pages) await page.screenshot({ path: join(root, `release-${kind}.png`) })
  const samples = []
  const osSamples = []
  const baseline = await application.evaluate(({ app }) => app.getAppMetrics())
  await new Promise(done => setTimeout(done, 5000))
  for (let index = 0; index < 6; index++) {
    samples.push(await application.evaluate(({ app }) => app.getAppMetrics()))
    osSamples.push(processSample())
    await new Promise(done => setTimeout(done, 1000))
  }
  report.performance = { method: 'app.getAppMetrics; 5s settle then 6 x 1s samples, all Electron processes; helper short-lived process not in metrics', baseline, samples,
    totals: samples.map(sample => ({ processes: sample.length, workingSetMB: sample.reduce((sum, item) => sum + item.memory.workingSetSize / 1024, 0), cpuPercent: sample.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0) })) }
  report.performance.osProcessTree = { method: 'Get-Process path prefix covering packaged app and helper; working-set sum (shared pages may be counted more than once); cumulative CPU delta/wall interval, 100%=one core. Short-lived processes between samples may be missed, not a peak guarantee.',
    samples: osSamples, host: { windowsRelease: release(), cpu: cpus()[0]?.model, logicalProcessors: cpus().length, memoryGB: totalmem() / 1024 ** 3 },
    totals: osSamples.map((sample, index) => {
      const prior = osSamples[index - 1]
      const priorById = new Map(prior?.processes.map(item => [item.Id, item.CPU]) ?? [])
      const delta = sample.processes.reduce((sum, item) => sum + Math.max(0, item.CPU - (priorById.get(item.Id) ?? item.CPU)), 0)
      return { processes: sample.processes.length, workingSetMB: sample.processes.reduce((sum, item) => sum + item.WorkingSet64 / 1024 ** 2, 0), cpuPercentOneCore: prior ? delta / ((sample.atMs - prior.atMs) / 1000) * 100 : null }
    }) }
  await writeFile(join(root, 'runtime-first.log'), first.output(), 'utf8')
  await application.close(); application = undefined
  // Construct an actual previous-schema fixture only after our isolated process closes.
  // The next packaged Electron process, not host Node, must perform the migration.
  const fixture = new DatabaseSync(join(data, 'data', 'quietdesk.sqlite3'))
  try {
    const oldSchema = fixture.prepare("SELECT sql FROM sqlite_master WHERE name='daily_log_items'").get().sql
      .replace(/CREATE TABLE "?daily_log_items"?/u, 'CREATE TABLE daily_log_items_v3_fixture')
      .replace('1002000', '1000000')
    assert.ok(oldSchema.includes('length(snapshot_markdown) <= 1000000'))
    fixture.exec(`BEGIN IMMEDIATE; ${oldSchema};
      INSERT INTO daily_log_items_v3_fixture SELECT * FROM daily_log_items;
      DROP TABLE daily_log_items;
      ALTER TABLE daily_log_items_v3_fixture RENAME TO daily_log_items;
      CREATE INDEX idx_daily_log_items_source ON daily_log_items(source_entity_type,source_entity_id);
      PRAGMA user_version=3; COMMIT;`)
  } finally { fixture.close() }
  const second = await start()
  const reopened = await invoke(second.pages.get('library'), 'notes', 'get', { id: noteId })
  assert.deepEqual(reopened, note)
  const migratedLog = await invoke(second.pages.get('library'), 'dailyLogs', 'get', { date: bootstrap.currentDate })
  assert.deepEqual(migratedLog.autoItems, manual.autoItems)
  assert.equal(migratedLog.manualMarkdown, manual.manualMarkdown)
  assert.equal(migratedLog.manualRevision, manual.manualRevision)
  const inspection = new DatabaseSync(join(data, 'data', 'quietdesk.sqlite3'), { readOnly: true })
  try {
    assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 4)
    assert.equal(inspection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(inspection.prepare('PRAGMA foreign_key_check').all(), [])
    report.migration = { from: 3, to: 4, runtime: 'packaged Electron', autoItemsPreserved: true, manualPreserved: true }
  } finally { inspection.close() }
  report.status = 'PASS'
  await writeFile(join(root, 'runtime-second.log'), second.output(), 'utf8')
  console.info(`STAGE6_RELEASE_PASS ${JSON.stringify({ root, electron: report.runs[0].electron, sqlite: report.runs[0].sqlite, host: report.host.mode, performance: report.performance.totals })}`)
} catch (error) {
  report.error = error.stack || String(error)
  throw error
} finally {
  await application?.close().catch(() => undefined)
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
}
