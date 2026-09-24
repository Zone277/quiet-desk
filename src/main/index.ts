import { app, globalShortcut, nativeTheme, powerMonitor, shell } from 'electron'
import { isAbsolute, resolve } from 'node:path'
import { FixedClock, SystemClock, type Clock } from '../shared/clock'
import { defaultCaptureShortcut, type CreateNoteRequest } from '../shared/ipc-contract'
import { createShellWindow } from './app-shell-windows'
import { registerDesktopSpikeIpc } from './ipc/desktop-spike-ipc'
import { registerQuietDeskIpc } from './ipc/quietdesk-ipc'
import type { QuietDeskWindows } from './ipc/window-registry'
import { GlobalShortcutManager } from './platform/global-shortcut-manager'
import { CoreDataService } from './services/core-data-service'
import { NoteStorageService } from './services/note-storage-service'
import {
  createCaptureWindowController,
  type CaptureWindowController
} from './windows/capture-window-controller'
import { createDesktopSpikeWindow, type DesktopSpikeController } from './windows/desktop-spike-window'

const STORAGE_SMOKE_NOTE_ID = '20000000-0000-4000-8000-000000000001'
const STORAGE_SMOKE_KEY = '20000000-0000-4000-8000-000000000002'
const STORAGE_SMOKE_REQUEST_ID = '20000000-0000-4000-8000-000000000003'
const STORAGE_SMOKE_INSTANT = '2026-09-21T08:00:00.000Z'

let controller: DesktopSpikeController | undefined
let storage: CoreDataService | undefined
let unregisterQuietDeskIpc: (() => void) | undefined
let captureWindowController: CaptureWindowController | undefined
let captureShortcutManager: GlobalShortcutManager | undefined
let testOccupiedShortcut: string | undefined

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
  if (process.env.QUIETDESK_TEST_USER_DATA && process.env.QUIETDESK_TEST_TIME_ZONE) {
    return process.env.QUIETDESK_TEST_TIME_ZONE
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function applicationClock(): Clock {
  const fixedInstant = process.env.QUIETDESK_TEST_USER_DATA
    ? process.env.QUIETDESK_TEST_NOW
    : undefined
  return fixedInstant ? new FixedClock(fixedInstant) : new SystemClock()
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

  const clock = applicationClock()
  storage = new CoreDataService({ databasePath, clock })
  const appTimeZone = storage.getOrCreateAppTimeZone(systemTimeZone())
  storage.reconcileActiveDailyLogs()
  powerMonitor.on('resume', () => {
    try {
      storage?.reconcileActiveDailyLogs()
    } catch (error) {
      console.error('QUIETDESK_DAILY_LOG_RESUME_ERROR', error)
    }
  })
  const preloadPath = resolve(__dirname, '../preload/index.js')
  const rendererDirectory = resolve(__dirname, '../renderer')
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  let failNextCaptureSubmit = Boolean(
    process.env.QUIETDESK_TEST_USER_DATA &&
    process.env.QUIETDESK_TEST_FAIL_NEXT_CAPTURE_SUBMIT === '1'
  )

  let resolveWindows: (windows: QuietDeskWindows) => void = () => undefined
  let rejectWindows: (error: unknown) => void = () => undefined
  const windowsPromise = new Promise<QuietDeskWindows>((resolvePromise, rejectPromise) => {
    resolveWindows = resolvePromise
    rejectWindows = rejectPromise
  })

  let resolveCaptureController: (captureController: CaptureWindowController) => void = () => undefined
  let rejectCaptureController: (error: unknown) => void = () => undefined
  const captureControllerPromise = new Promise<CaptureWindowController>((resolvePromise, rejectPromise) => {
    resolveCaptureController = resolvePromise
    rejectCaptureController = rejectPromise
  })

  let resolveShortcutManager: (shortcutManager: GlobalShortcutManager) => void = () => undefined
  let rejectShortcutManager: (error: unknown) => void = () => undefined
  const shortcutManagerPromise = new Promise<GlobalShortcutManager>((resolvePromise, rejectPromise) => {
    resolveShortcutManager = resolvePromise
    rejectShortcutManager = rejectPromise
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
    defaultLocale: detectLocale(),
    captureController: captureControllerPromise,
    shortcutManager: shortcutManagerPromise,
    failCaptureSubmitOnce: () => {
      if (!failNextCaptureSubmit) return false
      failNextCaptureSubmit = false
      return true
    },
    openExternal: async (url) => {
      if (
        process.env.QUIETDESK_TEST_USER_DATA &&
        process.env.QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN === '1'
      ) {
        console.info(`QUIETDESK_TEST_EXTERNAL_LINK ${JSON.stringify({ url })}`)
        return
      }
      await shell.openExternal(url)
    },
    applyTheme: (theme) => {
      nativeTheme.themeSource = theme
    },
    resolvedTheme: () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
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
    captureWindowController = createCaptureWindowController(capture)
    resolveCaptureController(captureWindowController)

    const initialShortcut = storage.getOrCreateCaptureShortcut(defaultCaptureShortcut)
    if (
      process.env.QUIETDESK_TEST_USER_DATA &&
      process.env.QUIETDESK_TEST_OCCUPY_SHORTCUT === '1' &&
      globalShortcut.register(initialShortcut, () => undefined)
    ) {
      testOccupiedShortcut = initialShortcut
    }

    captureShortcutManager = new GlobalShortcutManager({
      registrar: globalShortcut,
      initialAccelerator: initialShortcut,
      onActivate: () => {
        captureWindowController?.activate('global-shortcut')
      }
    })
    captureShortcutManager.register()
    resolveShortcutManager(captureShortcutManager)
    resolveWindows({ widget: widgetController.window, capture, library })
  } catch (error) {
    rejectWindows(error)
    rejectCaptureController(error)
    rejectShortcutManager(error)
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
  captureShortcutManager?.dispose()
  captureShortcutManager = undefined
  if (testOccupiedShortcut) globalShortcut.unregister(testOccupiedShortcut)
  testOccupiedShortcut = undefined
  captureWindowController?.dispose()
  captureWindowController = undefined
  unregisterQuietDeskIpc?.()
  unregisterQuietDeskIpc = undefined
  storage?.close()
  storage = undefined
  void controller?.dispose()
})

app.on('window-all-closed', () => {
  app.quit()
})
