import { app, dialog, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { Locale } from '../shared/ipc-contract'
import type { QuietDeskWindows } from './ipc/window-registry'

export interface TrayActions {
  visible(): boolean
  show(): void
  hide(): void
  library(): void
  settings(): void
  quit(): void
  loginEnabled(): boolean
  canConfigureLogin: boolean
  setLogin(enabled: boolean): void
}

export function trayTemplate(locale: Locale, actions: TrayActions): MenuItemConstructorOptions[] {
  const zh = locale === 'zh-CN'
  return [
    { id: 'widget-show', label: zh ? '显示桌面组件' : 'Show widget', click: actions.show },
    { id: 'widget-hide', label: zh ? '隐藏桌面组件' : 'Hide widget', enabled: actions.visible(), click: actions.hide },
    { id: 'library-open', label: zh ? '打开资料库' : 'Open Library', click: actions.library },
    { id: 'settings', label: zh ? '设置' : 'Settings', submenu: [
      { id: 'settings-open', label: zh ? '语言、主题与快捷键' : 'Language, theme and shortcut', click: actions.settings },
      { id: 'launch-at-login', label: zh ? '登录后启动（默认关闭）' : 'Launch at login (off by default)',
        type: 'checkbox', checked: actions.loginEnabled(), enabled: actions.canConfigureLogin,
        click: (item) => actions.setLogin(item.checked) }
    ] },
    { type: 'separator' },
    { id: 'application-quit', label: zh ? '退出 QuietDesk' : 'Quit QuietDesk', click: actions.quit }
  ]
}

function trayIcon(): Electron.NativeImage {
  // Original 16px Q/card motif; local pixels, no branded assets or remote fonts.
  const pixels = Buffer.alloc(16 * 16 * 4)
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const index = (y * 16 + x) * 4
    const line = ((x === 4 || x === 11) && y >= 4 && y <= 10) ||
      ((y === 4 || y === 10) && x >= 4 && x <= 11) || (x === y && x >= 9 && x <= 12)
    pixels[index] = line ? 240 : 115
    pixels[index + 1] = line ? 245 : 92
    pixels[index + 2] = line ? 250 : 55
    pixels[index + 3] = 255
  }
  return nativeImage.createFromBitmap(pixels, { width: 16, height: 16, scaleFactor: 1 })
}

export function createQuietDeskTray(windows: QuietDeskWindows, locale: () => Locale): { dispose(): void } {
  const tray = new Tray(trayIcon())
  tray.setToolTip('QuietDesk — 开发预览 / Desktop acceptance incomplete')
  const loginPath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  const canConfigureLogin = app.isPackaged && process.platform === 'win32' && !process.env.QUIETDESK_TEST_USER_DATA
  const loginOptions = { path: loginPath, args: [] as string[] }
  const openLibrary = (): void => { windows.library.show(); windows.library.focus() }
  const actions: TrayActions = {
    visible: () => windows.widget.isVisible(),
    show: () => windows.widget.showInactive(),
    hide: () => windows.widget.hide(),
    library: openLibrary,
    settings: openLibrary,
    quit: () => app.quit(),
    canConfigureLogin,
    loginEnabled: () => canConfigureLogin && app.getLoginItemSettings(loginOptions).openAtLogin,
    setLogin: (enabled) => {
      if (!canConfigureLogin) return
      try {
        // Called only by an explicit checkbox click. Startup never changes login settings.
        app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled })
        if (app.getLoginItemSettings(loginOptions).openAtLogin !== enabled) {
          throw new Error('Windows did not apply the login preference')
        }
      } catch {
        void dialog.showMessageBox(windows.library, {
          type: 'error', title: 'QuietDesk', message: '无法更新登录启动设置 / Unable to update launch-at-login.'
        })
      }
      refresh()
    }
  }
  const refresh = (): void => tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(locale(), actions)))
  const onClick = (): void => { actions.show(); refresh() }
  tray.on('click', onClick)
  windows.widget.on('show', refresh)
  windows.widget.on('hide', refresh)
  tray.on('right-click', refresh)
  refresh()
  console.info('QUIETDESK_TRAY_READY')
  return { dispose: () => {
    windows.widget.off('show', refresh)
    windows.widget.off('hide', refresh)
    tray.removeAllListeners()
    tray.destroy()
  } }
}
