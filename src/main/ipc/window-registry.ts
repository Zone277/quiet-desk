import type { BrowserWindow, WebContents } from 'electron'
import type { WindowKind } from '../../shared/ipc-contract'

export type QuietDeskWindows = Record<WindowKind, BrowserWindow>

export function senderWindowKind(sender: WebContents, windows: QuietDeskWindows): WindowKind | undefined {
  for (const [kind, window] of Object.entries(windows) as Array<[WindowKind, BrowserWindow]>) {
    if (!window.isDestroyed() && window.webContents === sender) return kind
  }
  return undefined
}
