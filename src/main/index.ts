import { app, nativeTheme } from 'electron'
import { isAbsolute, resolve } from 'node:path'
import { FixedClock, SystemClock, type Clock } from '../shared/clock'
import type { CreateNoteRequest } from '../shared/ipc-contract'
import { createShellWindow } from './app-shell-windows'
import { registerDesktopSpikeIpc } from './ipc/desktop-spike-ipc'
import { registerQuietDeskIpc } from './ipc/quietdesk-ipc'
import type { QuietDeskWindows } from './ipc/window-registry'
import { NoteStorageService } from './services/note-storage-service'
import { createDesktopSpikeWindow, type DesktopSpikeController } from './windows/desktop-spike-window'

const STORAGE_SMOKE_NOTE_ID = '20000000-0000-4000-8000-000000000001'
const STORAGE_SMOKE_KEY = '20000000-0000-4000-8000-000000000002'
const STORAGE_SMOKE_REQUEST_ID = '20000000-0000-4000-8000-000000000003'
const STORAGE_SMOKE_INSTANT = '2026-09-21T08:00:00.000Z'

let controller: DesktopSpikeController | undefined
let storage: NoteStorageService | undefined
let unregisterQuietDeskIpc: (() => void) | undefined

function configureUserDataPath(): void {
  const requestedUserData = process.env.QUIETDESK_TEST_USER_DATA
  if (requestedUserData) {
    app.setPath('userData', isAbsolute(requestedUserData) ? requestedUserData : resolve(requestedUserData))
    return
  }

  if (!app.isPackaged) {
    const suffix = process.env.QUIETDESK_DATA_MODE === 'demo' ? 'demo' : 'preview'
    app.setPath('userData', resolve(app.getPath('appData'), `QuietDesk-${suffix}`))
  }
}

function rendererEntry(baseUrl: string | undefined, kind: keyof QuietDeskWindows): string | undefined {
  if (!baseUrl) return undefined
  return new URL(`${kind}.html`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

function detectLocale(): 'zh-CN' | 'en-US' {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function smokeRequest(): CreateNoteRequest {
  return {
    requestId: STORAGE_SMOKE_REQUEST_ID,
    idempotencyKey: STORAGE_SMOKE_KEY,
    payload: {
      id: STORAGE_SMOKE_NOTE_ID,
      title: 'Electron SQLite smoke / 存储烟雾',
      bodyMarkdown: '# QuietDesk\n\n中英文 persistence ✓'
    }
  }
}

function runStorageSmoke(databasePath: string, mode: string): void {
  const clock: Clock = new FixedClock(STORAGE_SMOKE_INSTANT)
  let service = new NoteStorageService({ databasePath, clock })
  try {
    if (mode === 'write-reopen') {
      const created = service.createNote(smokeRequest())
      const replayed = service.createNote(smokeRequest())
      service.close()
      service = new NoteStorageService({ databasePath, clock })
      const reopened = service.getNote(STORAGE_SMOKE_NOTE_ID)
      console.info(`QUIETDESK_STORAGE_SMOKE ${JSON.stringify({
        mode,
        electron: process.versions.electron,
        node: process.versions.node,
        sqlite: process.versions.sqlite,
        created,
        replayed,
        reopened,
        revision: service.getDataRevision()
      })}`)
    } else if (mode === 'read-after-restart') {
      console.info(`QUIETDESK_STORAGE_SMOKE ${JSON.stringify({
        mode,
        electron: process.versions.electron,
        node: process.versions.node,
        sqlite: process.versions.sqlite,
        note: service.getNote(STORAGE_SMOKE_NOTE_ID),
        revision: service.getDataRevision()
      })}`)
    } else {
      throw new Error(`Unknown storage smoke mode: ${mode}`)
    }
  } finally {
    service.close()
  }
}

configureUserDataPath()

app.whenReady().then(async () => {
  const databasePath = resolve(app.getPath('userData'), 'data', 'quietdesk.sqlite3')
  const smokeMode = process.env.QUIETDESK_STORAGE_SMOKE_MODE
  if (smokeMode) {
    runStorageSmoke(databasePath, smokeMode)
    app.quit()
    return
  }

  const clock = new SystemClock()
  storage = new NoteStorageService({ databasePath, clock })
  const appTimeZone = storage.getOrCreateAppTimeZone(systemTimeZone())
  const preloadPath = resolve(__dirname, '../preload/index.js')
  const rendererDirectory = resolve(__dirname, '../renderer')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  let resolveWindows: (windows: QuietDeskWindows) => void = () => undefined
  let rejectWindows: (error: unknown) => void = () => undefined
  const windowsPromise = new Promise<QuietDeskWindows>((resolvePromise, rejectPromise) => {
    resolveWindows = resolvePromise
    rejectWindows = rejectPromise
  })

  const controllerPromise = createDesktopSpikeWindow({
    preloadPath,
    rendererUrl: rendererEntry(rendererUrl, 'widget'),
    rendererFile: resolve(rendererDirectory, 'widget.html'),
    statePath: resolve(app.getPath('userData'), 'desktop-window-state.json'),
    forceFallback: process.env.QUIETDESK_FORCE_FALLBACK === '1'
  })

  registerDesktopSpikeIpc(controllerPromise)
  unregisterQuietDeskIpc = registerQuietDeskIpc({
    service: storage,
    windows: windowsPromise,
    clock,
    appTimeZone,
    locale: detectLocale(),
    resolvedTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  try {
    const [widgetController, capture, library] = await Promise.all([
      controllerPromise,
      createShellWindow({
        kind: 'capture',
        preloadPath,
        rendererUrl,
        rendererDirectory,
        showForTesting: process.env.QUIETDESK_SHOW_ALL_WINDOWS === '1'
      }),
      createShellWindow({
        kind: 'library',
        preloadPath,
        rendererUrl,
        rendererDirectory,
        showForTesting: process.env.QUIETDESK_SHOW_ALL_WINDOWS === '1'
      })
    ])
    controller = widgetController
    resolveWindows({ widget: widgetController.window, capture, library })
  } catch (error) {
    rejectWindows(error)
    throw error
  }

  const autoQuitMs = Number.parseInt(process.env.QUIETDESK_AUTO_QUIT_MS ?? '', 10)
  if (Number.isFinite(autoQuitMs) && autoQuitMs > 0) {
    setTimeout(() => app.quit(), autoQuitMs).unref()
  }
}).catch((error: unknown) => {
  console.error('QUIETDESK_DESKTOP_FATAL', error)
  app.exit(1)
})

app.on('before-quit', () => {
  unregisterQuietDeskIpc?.()
  unregisterQuietDeskIpc = undefined
  storage?.close()
  storage = undefined
  void controller?.dispose()
})

app.on('window-all-closed', () => {
  app.quit()
})
