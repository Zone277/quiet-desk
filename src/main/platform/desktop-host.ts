import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NativeHostSnapshot } from '../../shared/desktop-spike'

const BRIDGE_TIMEOUT_MS = 5_000
const MAX_BRIDGE_OUTPUT_BYTES = 64 * 1024

type BridgeAction = 'attach' | 'inspect' | 'detach'

interface BridgeResult {
  action: BridgeAction
  success: boolean
  route?: string
  targetHandle?: string
  targetClass?: string
  parentHandle?: string
  parentClass?: string
  styleHex?: string
  exStyleHex?: string
  error?: string
}

export interface DesktopHostAdapter {
  readonly kind: 'windows-python-ctypes' | 'fallback'
  attach(nativeHandle: string): Promise<NativeHostSnapshot>
  inspect(nativeHandle: string): Promise<NativeHostSnapshot>
  detach(nativeHandle: string): Promise<void>
}

export interface DesktopHostAdapterOptions {
  forceFallback: boolean
  bridgeScriptPath?: string
}

function fallbackSnapshot(reason: string): NativeHostSnapshot {
  return {
    bridge: 'none',
    operation: 'fallback',
    success: false,
    error: reason
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseBridgeResult(stdout: string, expectedAction: BridgeAction): BridgeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    throw new Error('Native bridge returned invalid JSON')
  }

  if (!isRecord(parsed) || parsed.action !== expectedAction || typeof parsed.success !== 'boolean') {
    throw new Error('Native bridge returned an invalid result shape')
  }

  return {
    action: expectedAction,
    success: parsed.success,
    route: optionalString(parsed, 'route'),
    targetHandle: optionalString(parsed, 'targetHandle'),
    targetClass: optionalString(parsed, 'targetClass'),
    parentHandle: optionalString(parsed, 'parentHandle'),
    parentClass: optionalString(parsed, 'parentClass'),
    styleHex: optionalString(parsed, 'styleHex'),
    exStyleHex: optionalString(parsed, 'exStyleHex'),
    error: optionalString(parsed, 'error')
  }
}

function toSnapshot(result: BridgeResult): NativeHostSnapshot {
  return {
    bridge: 'python-ctypes',
    operation: result.action === 'inspect' ? 'inspect' : 'attach',
    success: result.success,
    route: result.route,
    targetHandle: result.targetHandle,
    targetClass: result.targetClass,
    parentHandle: result.parentHandle,
    parentClass: result.parentClass,
    styleHex: result.styleHex,
    exStyleHex: result.exStyleHex,
    error: result.error
  }
}

function validateNativeHandle(nativeHandle: string): void {
  if (!/^[1-9][0-9]*$/.test(nativeHandle)) {
    throw new Error('Native window handle must be a positive decimal integer')
  }
}

function findBridgeScript(explicitPath?: string): string | undefined {
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath
  }

  const candidates = [
    resolve(process.resourcesPath, 'native', 'windows_desktop_host.py'),
    resolve(app.getAppPath(), 'native', 'windows_desktop_host.py'),
    resolve(process.cwd(), 'native', 'windows_desktop_host.py'),
    resolve(__dirname, '../../native/windows_desktop_host.py')
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

class FallbackDesktopHostAdapter implements DesktopHostAdapter {
  readonly kind = 'fallback' as const

  constructor(private readonly reason: string) {}

  async attach(_nativeHandle: string): Promise<NativeHostSnapshot> {
    return fallbackSnapshot(this.reason)
  }

  async inspect(_nativeHandle: string): Promise<NativeHostSnapshot> {
    return fallbackSnapshot(this.reason)
  }

  async detach(_nativeHandle: string): Promise<void> {}
}

class WindowsPythonDesktopHostAdapter implements DesktopHostAdapter {
  readonly kind = 'windows-python-ctypes' as const

  constructor(private readonly scriptPath: string) {}

  async attach(nativeHandle: string): Promise<NativeHostSnapshot> {
    return toSnapshot(await this.runBridge('attach', nativeHandle))
  }

  async inspect(nativeHandle: string): Promise<NativeHostSnapshot> {
    return toSnapshot(await this.runBridge('inspect', nativeHandle))
  }

  async detach(nativeHandle: string): Promise<void> {
    try {
      await this.runBridge('detach', nativeHandle)
    } catch (error) {
      console.warn('QUIETDESK_DESKTOP_DETACH_ERROR', error)
    }
  }

  private async runBridge(action: BridgeAction, nativeHandle: string): Promise<BridgeResult> {
    validateNativeHandle(nativeHandle)

    return await new Promise<BridgeResult>((resolvePromise, rejectPromise) => {
      const child = spawn('python', [this.scriptPath, action, nativeHandle], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let outputExceeded = false
      let settled = false

      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        callback()
      }

      const timeout = setTimeout(() => {
        child.kill()
        finish(() => rejectPromise(new Error(`Native bridge timed out after ${BRIDGE_TIMEOUT_MS} ms`)))
      }, BRIDGE_TIMEOUT_MS)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > MAX_BRIDGE_OUTPUT_BYTES) {
          outputExceeded = true
          child.kill()
          return
        }
        stdout += chunk
      })

      child.stderr.on('data', (chunk: string) => {
        if (Buffer.byteLength(stderr) < MAX_BRIDGE_OUTPUT_BYTES) {
          stderr += chunk
        }
      })

      child.once('error', (error) => {
        finish(() => rejectPromise(new Error(`Native bridge failed to start: ${error.message}`)))
      })

      child.once('close', (code) => {
        finish(() => {
          if (outputExceeded) {
            rejectPromise(new Error('Native bridge output exceeded the safety limit'))
            return
          }
          if (code !== 0) {
            const detail = stderr.trim() || stdout.trim() || `exit code ${String(code)}`
            rejectPromise(new Error(`Native bridge failed: ${detail}`))
            return
          }

          try {
            resolvePromise(parseBridgeResult(stdout, action))
          } catch (error) {
            rejectPromise(error)
          }
        })
      })
    })
  }
}

export function createDesktopHostAdapter(options: DesktopHostAdapterOptions): DesktopHostAdapter {
  if (options.forceFallback) {
    return new FallbackDesktopHostAdapter('Desktop mode was disabled by QUIETDESK_FORCE_FALLBACK')
  }
  if (process.platform !== 'win32') {
    return new FallbackDesktopHostAdapter(`Desktop host is only implemented for Windows, not ${process.platform}`)
  }

  const scriptPath = findBridgeScript(options.bridgeScriptPath)
  if (!scriptPath) {
    return new FallbackDesktopHostAdapter('The fixed Windows desktop bridge script was not found')
  }

  return new WindowsPythonDesktopHostAdapter(scriptPath)
}
