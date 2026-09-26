import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NativeHostSnapshot } from '../../src/shared/desktop-spike'
import type { DesktopHostAdapter } from '../../src/main/platform/desktop-host'

// Controller unit tests only; these do not claim native GUI or Shell validation.
const surfaces = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return { screen: new Emitter(), powerMonitor: new Emitter() }
})
vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: Object.assign(surfaces.screen, {
    getDisplayMatching: () => ({ id: 1, scaleFactor: 1.5,
      bounds: { x: 0, y: 0, width: 1707, height: 1067 },
      workArea: { x: 0, y: 0, width: 1707, height: 1019 } })
  }),
  powerMonitor: surfaces.powerMonitor
}))
import { DesktopSpikeWindowController } from '../../src/main/windows/desktop-spike-window'

class TestWindow extends EventEmitter {
  bounds = { x: 80, y: 100, width: 480, height: 420 }
  destroyed = false
  getNativeWindowHandle(): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(123n); return b }
  getBounds() { if (this.destroyed) throw new Error('dead window access'); return { ...this.bounds } }
  getContentBounds() { return this.getBounds() }
  setBounds(bounds: typeof this.bounds) { this.bounds = { ...bounds }; this.emit('resize') }
  isDestroyed() { return this.destroyed }
  isAlwaysOnTop() { return false }
  isFocusable() { return true }
  isResizable() { return true }
  isVisible() { return false }
  isFocused() { return false }
}

const roots: string[] = []
afterEach(async () => {
  surfaces.screen.removeAllListeners()
  surfaces.powerMonitor.removeAllListeners()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(adapter: DesktopHostAdapter) {
  const root = await mkdtemp(join(tmpdir(), 'quietdesk-desktop-lifecycle-'))
  roots.push(root)
  const window = new TestWindow()
  const statePath = join(root, 'desktop-window-state.json')
  const controller = new DesktopSpikeWindowController(window as unknown as BrowserWindow, adapter, statePath)
  return { window, controller, statePath }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const attached: NativeHostSnapshot = {
  bridge: 'win32-helper', operation: 'attach', success: true, parentClass: 'WorkerW'
}

describe('Desktop controller lifecycle (no GUI)', () => {
  test('dispose drains in-flight attach, detaches once, flushes exact last bounds and removes listeners', async () => {
    const pending = deferred<NativeHostSnapshot>()
    const operations: string[] = []
    const adapter: DesktopHostAdapter = {
      kind: 'windows-win32-helper',
      attach: vi.fn(async () => { operations.push('attach'); return pending.promise }),
      inspect: vi.fn(async () => attached),
      detach: vi.fn(async () => { operations.push('detach') })
    }
    const { window, controller, statePath } = await fixture(adapter)
    const retry = controller.retryHost('test')
    const coalesced = controller.retryHost('simultaneous')
    const rejected = expect(retry).rejects.toThrow(/disposal/u)
    const coalescedRejected = expect(coalesced).rejects.toThrow(/disposal/u)
    window.bounds = { x: 123, y: 150, width: 437, height: 386 }
    window.emit('resize')
    const disposing = controller.dispose()
    expect(controller.dispose()).toBe(disposing)
    expect(operations).toEqual(['attach'])
    pending.resolve(attached)
    await rejected
    await coalescedRejected
    await disposing
    expect(adapter.attach).toHaveBeenCalledTimes(1)
    expect(operations).toEqual(['attach', 'detach'])
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      bounds: { x: 123, y: 150, width: 437, height: 386 }, scaleFactor: 1.5
    })
    expect(window.listenerCount('resize')).toBe(0)
    expect(window.listenerCount('move')).toBe(0)
    expect(surfaces.screen.listenerCount('display-removed')).toBe(0)
    expect(surfaces.powerMonitor.listenerCount('resume')).toBe(0)
    await expect(controller.retryHost('late')).rejects.toThrow(/disposed/u)
  })

  test('a window destroyed during attach is not read, resized, or detached afterward', async () => {
    const pending = deferred<NativeHostSnapshot>()
    const adapter: DesktopHostAdapter = {
      kind: 'windows-win32-helper', attach: async () => pending.promise,
      inspect: async () => attached, detach: vi.fn(async () => undefined)
    }
    const { window, controller } = await fixture(adapter)
    const retry = controller.retryHost('test')
    const rejected = expect(retry).rejects.toThrow(/disposal/u)
    window.destroyed = true
    pending.resolve(attached)
    await rejected
    await controller.dispose()
    expect(adapter.detach).not.toHaveBeenCalled()
  })
})
