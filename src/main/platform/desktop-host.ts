import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NativeHostSnapshot } from '../../shared/desktop-spike'

const BRIDGE_TIMEOUT_MS = 5_000
const MAX_BRIDGE_OUTPUT_BYTES = 64 * 1024

type BridgeAction = 'attach' | 'inspect' | 'detach' | 'resize'

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
  readonly kind: 'windows-win32-helper' | 'fallback'
  attach(nativeHandle: string): Promise<NativeHostSnapshot>
  inspect(nativeHandle: string): Promise<NativeHostSnapshot>
  detach(nativeHandle: string): Promise<void>
  adjustSize?(nativeHandle: string, widthDeltaPx: number, heightDeltaPx: number): Promise<void>
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
    bridge: 'win32-helper',
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
  if (!app.isPackaged && explicitPath && existsSync(explicitPath)) {
    return explicitPath
  }

  const candidates = app.isPackaged
    ? [resolve(process.resourcesPath, 'native', 'windows_desktop_host.exe')]
    : [resolve(app.getAppPath(), 'native', 'bin', 'windows_desktop_host.exe')]

  return candidates.find((candidate) => existsSync(candidate))
}

class FallbackDesktopHostAdapter implements DesktopHostAdapter {
  readonly kind = 'fallback' as const

  constructor(private readonly reason: string, private readonly geometryAdapter?: DesktopHostAdapter) {}

  async adjustSize(nativeHandle: string, widthDeltaPx: number, heightDeltaPx: number): Promise<void> {
    await this.geometryAdapter?.adjustSize?.(nativeHandle, widthDeltaPx, heightDeltaPx)
  }

  async attach(_nativeHandle: string): Promise<NativeHostSnapshot> {
    return fallbackSnapshot(this.reason)
  }

  async inspect(_nativeHandle: string): Promise<NativeHostSnapshot> {
    return fallbackSnapshot(this.reason)
  }

  async detach(_nativeHandle: string): Promise<void> {}
}

class WindowsNativeDesktopHostAdapter implements DesktopHostAdapter {
  readonly kind = 'windows-win32-helper' as const

  constructor(private readonly scriptPath: string) {}

  async adjustSize(nativeHandle: string, widthDeltaPx: number, heightDeltaPx: number): Promise<void> {
    await this.runBridge('resize', nativeHandle, [String(widthDeltaPx), String(heightDeltaPx)])
  }

  async attach(nativeHandle: string): Promise<NativeHostSnapshot> {
    return toSnapshot(await this.runBridge('attach', nativeHandle))
  }

  async inspect(nativeHandle: string): Promise<NativeHostSnapshot> {
    return toSnapshot(await this.runBridge('inspect', nativeHandle))
  }

  async detach(nativeHandle: string): Promise<void> {
    await this.runBridge('detach', nativeHandle)
  }

  private async runBridge(action: BridgeAction, nativeHandle: string, geometry: string[] = []): Promise<BridgeResult> {
    validateNativeHandle(nativeHandle)

    return await new Promise<BridgeResult>((resolvePromise, rejectPromise) => {
      const child = spawn(this.scriptPath, [action, nativeHandle, String(process.pid), ...geometry], {
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
    const helper = process.platform === 'win32' ? findBridgeScript(options.bridgeScriptPath) : undefined
    return new FallbackDesktopHostAdapter('Desktop mode was disabled by QUIETDESK_FORCE_FALLBACK',
      helper ? new WindowsNativeDesktopHostAdapter(helper) : undefined)
  }
  if (process.platform !== 'win32') {
    return new FallbackDesktopHostAdapter(`Desktop host is only implemented for Windows, not ${process.platform}`)
  }

  const scriptPath = findBridgeScript(options.bridgeScriptPath)
  if (!scriptPath) {
    return new FallbackDesktopHostAdapter('The fixed Windows desktop helper was not found; build native/build-helper.ps1 and package its executable')
  }

  return new WindowsNativeDesktopHostAdapter(scriptPath)
}
