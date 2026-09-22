import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { QUIETDESK_CHANNELS } from '../../shared/ipc-channels'
import type { WindowOpenContext } from '../../shared/ipc-contract'

export type CaptureWindowOpenContext = Extract<WindowOpenContext, { target: 'capture' }>
export type CaptureActivationSource = CaptureWindowOpenContext['source']

export interface PreventableCloseEvent {
  preventDefault(): void
}

export interface CaptureWindowLike {
  readonly webContents: {
    isDestroyed(): boolean
    send(channel: string, ...args: unknown[]): void
  }
  on(event: 'close', listener: (event: PreventableCloseEvent) => void): this
  off(event: 'close', listener: (event: PreventableCloseEvent) => void): this
  isDestroyed(): boolean
  show(): void
  focus(): void
  hide(): void
  destroy(): void
}

export interface CaptureWindowControllerOptions {
  createActivationId?: () => string
}

/** Keeps Quick Capture resident while ordinary window closes only hide it. */
export class CaptureWindowController {
  private readonly createActivationId: () => string
  private disposed = false

  private readonly onClose = (event: PreventableCloseEvent): void => {
    if (this.disposed || this.window.isDestroyed()) return
    event.preventDefault()
    this.window.hide()
  }

  constructor(
    private readonly window: CaptureWindowLike,
    options: CaptureWindowControllerOptions = {}
  ) {
    this.createActivationId = options.createActivationId ?? randomUUID
    this.window.on('close', this.onClose)
  }

  activate(source: CaptureActivationSource): CaptureWindowOpenContext | undefined {
    const context: CaptureWindowOpenContext = {
      target: 'capture',
      source,
      activationId: this.createActivationId(),
      focusEditor: true
    }
    return this.show(context) ? context : undefined
  }

  show(context: CaptureWindowOpenContext): boolean {
    if (!this.isAvailable()) return false
    this.window.show()
    this.window.focus()
    this.window.webContents.send(QUIETDESK_CHANNELS.windowContext, context)
    return true
  }

  hide(): boolean {
    if (!this.isAvailable()) return false
    this.window.hide()
    return true
  }

  isAvailable(): boolean {
    return !this.disposed && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.window.off('close', this.onClose)
    if (!this.window.isDestroyed()) this.window.destroy()
  }
}

export function createCaptureWindowController(
  window: BrowserWindow,
  options: CaptureWindowControllerOptions = {}
): CaptureWindowController {
  return new CaptureWindowController(window, options)
}
