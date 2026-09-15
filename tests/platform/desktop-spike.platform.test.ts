import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, test } from 'vitest'
import type { DesktopHostStatus } from '../../src/shared/desktop-spike'

const PROJECT_ROOT = resolve(process.cwd())
const BRIDGE_PATH = join(PROJECT_ROOT, 'native', 'windows_desktop_host.py')
const TEST_TIMEOUT_MS = 20_000
const PROCESS_TIMEOUT_MS = 12_000
const require = createRequire(import.meta.url)
const electronPath = require('electron') as string

interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

interface RuntimeResult extends ProcessResult {
  statuses: DesktopHostStatus[]
}

const liveChildren = new Set<ChildProcess>()
const temporaryRoots = new Set<string>()

function terminateOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return Promise.resolve()
  }

  return new Promise((resolvePromise) => {
    if (process.platform !== 'win32') {
      child.kill('SIGKILL')
      resolvePromise()
      return
    }

    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.once('error', () => {
      child.kill()
      resolvePromise()
    })
    killer.once('close', () => resolvePromise())
  })
}

async function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    onStdoutChunk?: (chunk: string) => void
  } = {}
): Promise<ProcessResult> {
  const child = spawn(executable, args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  liveChildren.add(child)

  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
    options.onStdoutChunk?.(chunk)
  })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })

  const timeout = setTimeout(() => {
    timedOut = true
    void terminateOwnedProcessTree(child)
  }, options.timeoutMs ?? PROCESS_TIMEOUT_MS)

  return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    child.once('error', (error) => {
      clearTimeout(timeout)
      liveChildren.delete(child)
      rejectPromise(error)
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      liveChildren.delete(child)
      resolvePromise({ code, signal, stdout, stderr, timedOut })
    })
  })
}

function parseSingleJson(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean)
  expect(lines).toHaveLength(1)
  return JSON.parse(lines[0] ?? '') as Record<string, unknown>
}

function parseStatusLines(stdout: string): DesktopHostStatus[] {
  const prefix = 'QUIETDESK_DESKTOP_STATUS '
  return stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)) as DesktopHostStatus)
}

async function makeIsolatedUserData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-platform-'))
  temporaryRoots.add(root)
  return root
}

async function runElectron(
  userData: string,
  forceFallback: boolean,
  options: { autoQuitMs?: number; onStdoutChunk?: (chunk: string) => void } = {}
): Promise<RuntimeResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QUIETDESK_TEST_USER_DATA: userData,
    QUIETDESK_AUTO_QUIT_MS: String(options.autoQuitMs ?? 1800)
  }
  delete env.ELECTRON_RUN_AS_NODE
  if (forceFallback) {
    env.QUIETDESK_FORCE_FALLBACK = '1'
  } else {
    delete env.QUIETDESK_FORCE_FALLBACK
  }

  const result = await runProcess(electronPath, [PROJECT_ROOT], {
    cwd: PROJECT_ROOT,
    env,
    timeoutMs: PROCESS_TIMEOUT_MS,
    onStdoutChunk: options.onStdoutChunk
  })
  return { ...result, statuses: parseStatusLines(result.stdout) }
}

function createStatusObserver(): {
  promise: Promise<DesktopHostStatus>
  onChunk: (chunk: string) => void
} {
  const prefix = 'QUIETDESK_DESKTOP_STATUS '
  let buffer = ''
  let settled = false
  let resolveStatus: (status: DesktopHostStatus) => void = () => undefined
  const promise = new Promise<DesktopHostStatus>((resolvePromise) => {
    resolveStatus = resolvePromise
  })

  return {
    promise,
    onChunk: (chunk: string) => {
      if (settled) {
        return
      }
      buffer += chunk
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      const line = lines.find((candidate) => candidate.startsWith(prefix))
      if (line) {
        settled = true
        resolveStatus(JSON.parse(line.slice(prefix.length)) as DesktopHostStatus)
      }
    }
  }
}

async function waitForStatus(
  promise: Promise<DesktopHostStatus>,
  timeoutMs: number
): Promise<DesktopHostStatus> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Electron status was not emitted within ${timeoutMs} ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function expectSafeWindowOptions(status: DesktopHostStatus): void {
  expect.soft(status.windowOptions).toMatchObject({
    alwaysOnTop: false,
    resizable: true,
    transparent: false
  })
  expect.soft(status.focused).toBe(false)
  expect.soft(status.windowBounds.width).toBe(480)
  expect.soft(status.windowBounds.height).toBe(420)
}

afterEach(async () => {
  await Promise.all([...liveChildren].map(async (child) => terminateOwnedProcessTree(child)))
  liveChildren.clear()

  const roots = [...temporaryRoots]
  temporaryRoots.clear()
  for (const root of roots) {
    const resolvedRoot = resolve(root)
    const resolvedTemp = resolve(tmpdir())
    const safeRelative = relative(resolvedTemp, resolvedRoot)
    if (!resolvedRoot.startsWith(resolve(resolvedTemp, 'quietdesk-platform-')) || safeRelative.startsWith('..')) {
      throw new Error(`Refusing to remove unexpected test path: ${resolvedRoot}`)
    }
    await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

describe.sequential('QuietDesk stage 1 platform spike', () => {
  test.skipIf(process.platform !== 'win32')(
    'Python bridge rejects missing, malformed, zero, and non-existent HWND values with structured JSON',
    async () => {
      const cases = [
        { args: [], code: 2, action: 'unknown', error: /Usage:/u },
        { args: ['inspect', 'not-a-hwnd'], code: 2, action: 'inspect', error: /positive decimal integer/u },
        { args: ['attach', '0'], code: 2, action: 'attach', error: /positive decimal integer/u },
        { args: ['inspect', '1'], code: 1, action: 'inspect', error: /not a live window/u }
      ]

      for (const item of cases) {
        const result = await runProcess('python', [BRIDGE_PATH, ...item.args], { timeoutMs: 5_000 })
        expect(result.timedOut).toBe(false)
        expect(result.code).toBe(item.code)
        expect(result.stderr).toBe('')
        const payload = parseSingleJson(result.stdout)
        expect(payload).toMatchObject({ action: item.action, success: false })
        expect(payload.error).toEqual(expect.stringMatching(item.error))
      }
    },
    TEST_TIMEOUT_MS
  )

  test('frozen configuration keeps the platform boundary narrow without claiming GUI behavior', async () => {
    const windowSource = await readFile(
      join(PROJECT_ROOT, 'src', 'main', 'windows', 'desktop-spike-window.ts'),
      'utf8'
    )
    const adapterSource = await readFile(
      join(PROJECT_ROOT, 'src', 'main', 'platform', 'desktop-host.ts'),
      'utf8'
    )
    const nativeSource = await readFile(BRIDGE_PATH, 'utf8')
    const ipcSource = await readFile(
      join(PROJECT_ROOT, 'src', 'main', 'ipc', 'desktop-spike-ipc.ts'),
      'utf8'
    )
    const mainSource = await readFile(join(PROJECT_ROOT, 'src', 'main', 'index.ts'), 'utf8')
    const packageJson = JSON.parse(await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    for (const expected of [
      'minWidth: MIN_WIDTH',
      'minHeight: MIN_HEIGHT',
      'transparent: false',
      'resizable: true',
      'show: false',
      'skipTaskbar: true',
      'alwaysOnTop: false',
      'contextIsolation: true',
      'sandbox: true',
      'nodeIntegration: false',
      'window.showInactive()'
    ]) {
      expect(windowSource).toContain(expected)
    }
    expect(windowSource).toContain("screen.on('display-removed'")
    expect(windowSource).toContain("screen.on('display-metrics-changed'")
    expect(windowSource).toContain('await rename(temporaryPath, statePath)')

    expect(adapterSource).toContain("spawn('python', [this.scriptPath, action, nativeHandle]")
    expect(adapterSource).toContain('shell: false')
    expect(adapterSource).toContain('validateNativeHandle(nativeHandle)')
    expect(adapterSource).not.toContain('shell: true')
    expect(adapterSource).not.toMatch(/\bexec(?:File)?\s*\(/u)

    expect(nativeSource).toContain('SetParent(target, host)')
    expect(nativeSource).toContain('raw_handle.isdecimal()')
    expect(nativeSource).not.toMatch(/CreateRemoteThread|WriteProcessMemory|OpenProcess/u)

    expect(ipcSource).toContain('event.sender !== controller.window.webContents')
    expect(ipcSource).toContain('DESKTOP_SPIKE_CHANNELS.getStatus')
    expect(ipcSource).toContain('DESKTOP_SPIKE_CHANNELS.retryHost')
    expect(mainSource).toContain("process.env.QUIETDESK_TEST_USER_DATA")
    expect(mainSource).toContain("process.env.QUIETDESK_FORCE_FALLBACK === '1'")
    expect(mainSource).toContain('process.env.QUIETDESK_AUTO_QUIT_MS')
    expect(packageJson.scripts?.['test:platform']).toBe('npm run build && vitest run tests/platform')
  })

  test.skipIf(process.platform !== 'win32')(
    'forced fallback runs in Electron with isolated state and honest status',
    async () => {
      const userData = await makeIsolatedUserData()
      const result = await runElectron(userData, true)

      expect(result.timedOut).toBe(false)
      expect(result.signal).toBeNull()
      expect(result.code, result.stderr).toBe(0)
      expect(result.statuses.length, result.stdout).toBeGreaterThanOrEqual(1)

      const status = result.statuses.at(-1)
      expect(status).toBeDefined()
      expect(status).toMatchObject({
        mode: 'fallback',
        attached: false,
        platform: 'win32',
        focused: false,
        native: {
          bridge: 'none',
          operation: 'fallback',
          success: false
        }
      })
      expect(status?.reason).toContain('QUIETDESK_FORCE_FALLBACK')
      console.info(`QA_S1_FORCED_FALLBACK_STATUS ${JSON.stringify(status)}`)
      expectSafeWindowOptions(status as DesktopHostStatus)

      const expectedStatePath = resolve(userData, 'desktop-window-state.json')
      expect(resolve(status?.statePath ?? '')).toBe(expectedStatePath)
      expect(relative(resolve(userData), expectedStatePath)).not.toMatch(/^\.\./u)
      await expect(stat(expectedStatePath)).resolves.toMatchObject({ isFile: expect.any(Function) })

      const stored = JSON.parse(await readFile(expectedStatePath, 'utf8')) as {
        version?: number
        bounds?: { width?: number; height?: number }
      }
      expect(stored).toMatchObject({
        version: 1,
        bounds: { width: 480, height: 420 }
      })
    },
    TEST_TIMEOUT_MS
  )

  test.skipIf(process.platform !== 'win32')(
    'non-forced Electron run emits a self-consistent WorkerW/Progman diagnostic',
    async () => {
      const userData = await makeIsolatedUserData()
      const observer = createStatusObserver()
      const runtimePromise = runElectron(userData, false, {
        autoQuitMs: 3_500,
        onStdoutChunk: observer.onChunk
      })
      const liveStatus = await waitForStatus(observer.promise, 3_000)
      const inspectionResult = liveStatus.mode === 'desktop'
        ? await runProcess('python', [BRIDGE_PATH, 'inspect', liveStatus.nativeHandle], { timeoutMs: 5_000 })
        : undefined
      const result = await runtimePromise

      expect(result.timedOut).toBe(false)
      expect(result.signal).toBeNull()
      expect(result.code, result.stderr).toBe(0)
      expect(result.statuses.length, result.stdout).toBeGreaterThanOrEqual(1)

      const status = result.statuses.at(-1) as DesktopHostStatus
      console.info(`QA_S1_NATIVE_DIAGNOSTIC ${JSON.stringify(status)}`)
      expectSafeWindowOptions(status)
      expect(status.platform).toBe('win32')
      expect(status.windowsBuild).toMatch(/^\d+$/u)
      expect(status.nativeHandle).toMatch(/^[1-9]\d*$/u)

      if (status.mode === 'desktop') {
        expect(status.attached).toBe(true)
        expect(status.native).toMatchObject({ bridge: 'python-ctypes', success: true })
        expect(status.native.parentClass).toMatch(/^(WorkerW|Progman)$/u)
        expect(status.native.parentHandle).toMatch(/^0x[0-9A-F]+$/u)
        expect(status.native.targetHandle).toMatch(/^0x[0-9A-F]+$/u)
        expect(status.native.styleHex).toMatch(/^0x[0-9A-F]+$/u)
        expect(status.native.exStyleHex).toMatch(/^0x[0-9A-F]+$/u)

        expect(inspectionResult).toBeDefined()
        expect(inspectionResult?.timedOut).toBe(false)
        expect(inspectionResult?.code, inspectionResult?.stderr).toBe(0)
        const inspection = parseSingleJson(inspectionResult?.stdout ?? '')
        expect(inspection).toMatchObject({
          action: 'inspect',
          success: true,
          targetHandle: status.native.targetHandle,
          parentHandle: status.native.parentHandle,
          parentClass: status.native.parentClass
        })
        console.info(`QA_S1_NATIVE_INSPECTION ${JSON.stringify(inspection)}`)
      } else {
        expect(status.attached).toBe(false)
        expect(status.reason.length).toBeGreaterThan(0)
        expect(status.native.success).toBe(false)
      }
    },
    TEST_TIMEOUT_MS
  )
})
