import { app } from 'electron'
import { isAbsolute, resolve } from 'node:path'
import { registerDesktopSpikeIpc } from './ipc/desktop-spike-ipc'
import { createDesktopSpikeWindow, type DesktopSpikeController } from './windows/desktop-spike-window'

let controller: DesktopSpikeController | undefined

const requestedUserData = process.env.QUIETDESK_TEST_USER_DATA
if (requestedUserData) {
  app.setPath('userData', isAbsolute(requestedUserData) ? requestedUserData : resolve(requestedUserData))
}

app.whenReady().then(async () => {
  const controllerPromise = createDesktopSpikeWindow({
    preloadPath: resolve(__dirname, '../preload/index.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: resolve(__dirname, '../renderer/index.html'),
    statePath: resolve(app.getPath('userData'), 'desktop-window-state.json'),
    forceFallback: process.env.QUIETDESK_FORCE_FALLBACK === '1'
  })

  registerDesktopSpikeIpc(controllerPromise)
  controller = await controllerPromise

  const autoQuitMs = Number.parseInt(process.env.QUIETDESK_AUTO_QUIT_MS ?? '', 10)
  if (Number.isFinite(autoQuitMs) && autoQuitMs > 0) {
    setTimeout(() => app.quit(), autoQuitMs).unref()
  }
}).catch((error: unknown) => {
  console.error('QUIETDESK_DESKTOP_FATAL', error)
  app.exit(1)
})

app.on('before-quit', () => {
  void controller?.dispose()
})

app.on('window-all-closed', () => {
  app.quit()
})
