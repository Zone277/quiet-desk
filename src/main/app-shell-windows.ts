import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { WindowKind } from '../shared/ipc-contract'

export interface ShellWindowOptions {
  kind: Exclude<WindowKind, 'widget'>
  preloadPath: string
  rendererUrl?: string
  rendererDirectory: string
  showForTesting: boolean
}

function entryUrl(baseUrl: string, kind: WindowKind): string {
  return new URL(`${kind}.html`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

export async function createShellWindow(options: ShellWindowOptions): Promise<BrowserWindow> {
  const capture = options.kind === 'capture'
  const window = new BrowserWindow({
    title: capture ? 'QuietDesk Capture' : 'QuietDesk Library',
    width: capture ? 520 : 900,
    height: capture ? 360 : 680,
    minWidth: capture ? 360 : 640,
    minHeight: capture ? 240 : 480,
    show: false,
    backgroundColor: '#f3f1eb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (options.rendererUrl) {
    await window.loadURL(entryUrl(options.rendererUrl, options.kind))
  } else {
    await window.loadFile(join(options.rendererDirectory, `${options.kind}.html`))
  }

  if (options.showForTesting) window.showInactive()
  return window
}
