import { describe, expect, test } from 'vitest'
import { QUIETDESK_CHANNELS } from '../../src/shared/ipc-channels'
import {
  CaptureWindowController,
  type CaptureWindowLike,
  type PreventableCloseEvent
} from '../../src/main/windows/capture-window-controller'

const ACTIVATION_ID = '30000000-0000-4000-8000-000000000001'

class FakeCaptureWindow implements CaptureWindowLike {
  readonly calls: Array<{ action: string; args?: unknown[] }> = []
  private closeListeners = new Set<(event: PreventableCloseEvent) => void>()
  private destroyed = false
  private webContentsDestroyed = false

  readonly webContents = {
    isDestroyed: (): boolean => this.webContentsDestroyed,
    send: (channel: string, ...args: unknown[]): void => {
      this.calls.push({ action: 'send', args: [channel, ...args] })
    }
  }

  on(event: 'close', listener: (event: PreventableCloseEvent) => void): this {
    expect(event).toBe('close')
    this.closeListeners.add(listener)
    return this
  }

  off(event: 'close', listener: (event: PreventableCloseEvent) => void): this {
    expect(event).toBe('close')
    this.closeListeners.delete(listener)
    return this
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  show(): void {
    this.calls.push({ action: 'show' })
  }

  focus(): void {
    this.calls.push({ action: 'focus' })
  }

  hide(): void {
    this.calls.push({ action: 'hide' })
  }

  destroy(): void {
    this.calls.push({ action: 'destroy' })
    this.destroyed = true
    this.webContentsDestroyed = true
  }

  emitClose(): boolean {
    let prevented = false
    const event: PreventableCloseEvent = {
      preventDefault: () => { prevented = true }
    }
    for (const listener of this.closeListeners) listener(event)
    return prevented
  }
}

function createController(window: FakeCaptureWindow): CaptureWindowController {
  return new CaptureWindowController(window, { createActivationId: () => ACTIVATION_ID })
}

describe('CaptureWindowController', () => {
  test('shows, focuses, and sends a focusEditor context for shortcut activation', () => {
    const window = new FakeCaptureWindow()
    const controller = createController(window)

    const context = controller.activate('global-shortcut')

    expect(context).toEqual({
      target: 'capture',
      source: 'global-shortcut',
      activationId: ACTIVATION_ID,
      focusEditor: true
    })
    expect(window.calls).toEqual([
      { action: 'show' },
      { action: 'focus' },
      {
        action: 'send',
        args: [QUIETDESK_CHANNELS.windowContext, context]
      }
    ])
  })

  test('turns a system close into hide without destroying the resident window', () => {
    const window = new FakeCaptureWindow()
    createController(window)

    expect(window.emitClose()).toBe(true)
    expect(window.calls).toEqual([{ action: 'hide' }])
    expect(window.isDestroyed()).toBe(false)
  })

  test('explicit hide does not dispose and no blur lifecycle is installed', () => {
    const window = new FakeCaptureWindow()
    const controller = createController(window)

    expect(controller.hide()).toBe(true)
    expect(controller.isAvailable()).toBe(true)
    expect(window.calls).toEqual([{ action: 'hide' }])
  })

  test('dispose removes close interception and destroys exactly once', () => {
    const window = new FakeCaptureWindow()
    const controller = createController(window)

    controller.dispose()
    controller.dispose()
    expect(window.emitClose()).toBe(false)

    expect(window.calls).toEqual([{ action: 'destroy' }])
    expect(controller.isAvailable()).toBe(false)
    expect(controller.activate('widget')).toBeUndefined()
  })
})
