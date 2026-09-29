import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const workspace = resolve(import.meta.dirname, '../..')
const evidenceRoot = join(workspace, 'test-results', 'stage8')
const diagnostic = join(evidenceRoot, 'stage8-desktop-diagnostic.exe')
const electron = join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe')
await mkdir(evidenceRoot, { recursive: true })
const runRoot = await mkdtemp(join(evidenceRoot, 'exit-smoke-'))
const userData = join(runRoot, 'userData')
await mkdir(userData)

function snapshot() {
  const result = spawnSync(diagnostic, [], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) throw new Error(`Diagnostic failed: ${result.error ?? result.stderr}`)
  return JSON.parse(result.stdout)
}

const before = snapshot()
const environment = { ...process.env, QUIETDESK_TEST_USER_DATA: userData, QUIETDESK_AUTO_QUIT_MS: '6000' }
for (const name of ['QUIETDESK_FORCE_FALLBACK', 'ELECTRON_RENDERER_URL', 'QUIETDESK_SHOW_ALL_WINDOWS',
  'QUIETDESK_TEST_NOW', 'QUIETDESK_STORAGE_SMOKE_MODE']) delete environment[name]

const child = spawn(electron, ['.'], { cwd: workspace, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
let timedOut = false
const timeout = setTimeout(() => { timedOut = true; child.kill() }, 20_000)
const exit = await new Promise((done) => child.once('close', (code, signal) => done({ code, signal })))
clearTimeout(timeout)
await new Promise((done) => setTimeout(done, 500))
const after = snapshot()

const statuses = [...stdout.matchAll(/^QUIETDESK_DESKTOP_STATUS (.+)$/gm)].map((match) => JSON.parse(match[1]))
const beforeHandles = new Set(before.shellWindows.map((window) => window.hwnd))
const afterHandles = new Set(after.shellWindows.map((window) => window.hwnd))
const report = {
  runRoot, userData, process: { pid: child.pid, ...exit, timedOut },
  attached: statuses.some((status) => status.mode === 'desktop' && status.attached),
  finalStatus: statuses.at(-1) && { mode: statuses.at(-1).mode, parentClass: statuses.at(-1).native?.parentClass },
  beforeShellWindowCount: before.shellWindows.length,
  afterShellWindowCount: after.shellWindows.length,
  newShellWindows: after.shellWindows.filter((window) => !beforeHandles.has(window.hwnd))
    .map(({ hwnd, className, visible, parentClass, bounds }) => ({ hwnd, className, visible, parentClass, bounds })),
  missingShellWindows: before.shellWindows.filter((window) => !afterHandles.has(window.hwnd))
    .map(({ hwnd, className }) => ({ hwnd, className })),
  diagnostics: { before, after },
  stderrExcerpt: stderr.split('\n').filter((line) => /SHUTDOWN_ERROR|DESKTOP_FATAL|QUIT_PREPARATION_ERROR/u.test(line))
}
await writeFile(join(runRoot, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ runRoot, process: report.process, attached: report.attached,
  finalStatus: report.finalStatus, beforeShellWindowCount: report.beforeShellWindowCount,
  afterShellWindowCount: report.afterShellWindowCount, newShellWindows: report.newShellWindows,
  stderrExcerpt: report.stderrExcerpt }))
if (timedOut || exit.code !== 0 || !report.attached) process.exitCode = 1
