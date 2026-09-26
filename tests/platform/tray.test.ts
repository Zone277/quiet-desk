import { EventEmitter } from 'node:events'
import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { QuietDeskWindows } from '../../src/main/ipc/window-registry'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    quit: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  },
  dialog: { showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
  nativeImage: { createFromBitmap: vi.fn(() => ({})) },
  trays: [] as Array<{
    setToolTip: ReturnType<typeof vi.fn>
    setContextMenu: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    removeAllListeners: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }>
}))

vi.mock('electron', () => ({
  ...electron,
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
    removeAllListeners = vi.fn()
    destroy = vi.fn()
    constructor() { electron.trays.push(this) }
  }
}))

import { createQuietDeskTray, trayTemplate, type TrayActions } from '../../src/main/tray'

function actions(visible = true, canConfigureLogin = false): TrayActions {
  return {
    visible: vi.fn(() => visible),
    show: vi.fn(), hide: vi.fn(), library: vi.fn(), settings: vi.fn(), quit: vi.fn(),
    loginEnabled: vi.fn(() => false), canConfigureLogin, setLogin: vi.fn()
  }
}

function flatten(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])
}

function item(template: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions {
  const result = flatten(template).find((entry) => entry.id === id)
  if (!result) throw new Error(`missing tray item ${id}`)
  return result
}

function click(entry: MenuItemConstructorOptions, checked = false): void {
  if (!entry.click) throw new Error(`missing click callback ${entry.id}`)
  entry.click({ checked } as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  electron.trays.length = 0
  electron.app.isPackaged = false
})

describe('Stage6 tray QA — mocked Electron, no Windows tray claim', () => {
  test.each(['zh-CN', 'en-US'] as const)('%s menu is complete and building it invokes no mutation', (locale) => {
    const owner = actions()
    const template = trayTemplate(locale, owner)
    expect(flatten(template).filter((entry) => entry.id).map((entry) => entry.id)).toEqual([
      'widget-show', 'widget-hide', 'library-open', 'settings', 'settings-open', 'launch-at-login', 'application-quit'
    ])
    expect(item(template, 'settings').submenu).toBeInstanceOf(Array)
    expect(item(template, 'launch-at-login')).toMatchObject({ type: 'checkbox', checked: false, enabled: false })
    for (const action of [owner.show, owner.hide, owner.library, owner.settings, owner.quit, owner.setLogin]) {
      expect(action).not.toHaveBeenCalled()
    }
    expect(item(template, 'application-quit').label).toBe(locale === 'zh-CN' ? '退出 QuietDesk' : 'Quit QuietDesk')
  })

  test('each action routes to exactly its owner callback', () => {
    const owner = actions()
    const template = trayTemplate('en-US', owner)
    const routes = [
      ['widget-show', owner.show], ['widget-hide', owner.hide], ['library-open', owner.library],
      ['settings-open', owner.settings], ['application-quit', owner.quit]
    ] as const
    for (const [id, callback] of routes) {
      click(item(template, id))
      expect(callback).toHaveBeenCalledOnce()
    }
    expect(owner.setLogin).not.toHaveBeenCalled()
  })

  test('hidden Widget disables hide while leaving show available', () => {
    const template = trayTemplate('zh-CN', actions(false))
    expect(item(template, 'widget-hide').enabled).toBe(false)
    expect(item(template, 'widget-show').enabled).not.toBe(false)
  })

  test('enabled checkbox forwards the clicked checked value, never changes OS during construction', () => {
    const owner = actions(true, true)
    const checkbox = item(trayTemplate('en-US', owner), 'launch-at-login')
    expect(checkbox.enabled).toBe(true)
    expect(owner.setLogin).not.toHaveBeenCalled()
    click(checkbox, true)
    click(checkbox, false)
    expect(owner.setLogin).toHaveBeenNthCalledWith(1, true)
    expect(owner.setLogin).toHaveBeenNthCalledWith(2, false)
  })

  test.each([false, true])('dev/isolated packaged=%s startup never mutates OS login; dispose removes own listeners', (packaged) => {
    electron.app.isPackaged = packaged
    vi.stubEnv('QUIETDESK_TEST_USER_DATA', 'C:\\QA isolated\\测试')
    const widget = Object.assign(new EventEmitter(), {
      isVisible: () => true, showInactive: vi.fn(), hide: vi.fn()
    })
    const library = { show: vi.fn(), focus: vi.fn() }
    const external = vi.fn()
    widget.on('show', external)
    const controller = createQuietDeskTray({ widget, library } as unknown as QuietDeskWindows, () => 'en-US')
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
    const tray = electron.trays[0]
    if (!tray) throw new Error('tray was not constructed')
    const template = electron.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[]
    const checkbox = item(template, 'launch-at-login')
    expect(checkbox.enabled).toBe(false)
    click(checkbox, true) // Programmatic callback cannot bypass disabled OS guard.
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(widget.listenerCount('show')).toBe(2)
    expect(widget.listenerCount('hide')).toBe(1)
    controller.dispose()
    expect(widget.listeners('show')).toEqual([external])
    expect(widget.listenerCount('hide')).toBe(0)
    expect(tray.removeAllListeners).toHaveBeenCalledOnce()
    expect(tray.destroy).toHaveBeenCalledOnce()
  })
})
