import { describe, expect, test, vi } from 'vitest'
import { defaultCaptureShortcut } from '../../src/shared/ipc-contract'
import {
  GlobalShortcutManager,
  type GlobalShortcutRegistrar
} from '../../src/main/platform/global-shortcut-manager'

class FakeRegistrar implements GlobalShortcutRegistrar {
  readonly calls: string[] = []
  readonly callbacks = new Map<string, () => void>()
  readonly rejected = new Set<string>()

  register(accelerator: string, callback: () => void): boolean {
    this.calls.push(`register:${accelerator}`)
    if (this.rejected.has(accelerator)) return false
    this.callbacks.set(accelerator, callback)
    return true
  }

  unregister(accelerator: string): void {
    this.calls.push(`unregister:${accelerator}`)
    this.callbacks.delete(accelerator)
  }

  activate(accelerator: string): void {
    this.callbacks.get(accelerator)?.()
  }
}

function createManager(
  registrar: FakeRegistrar
): { manager: GlobalShortcutManager; onActivate: ReturnType<typeof vi.fn> } {
  const onActivate = vi.fn()
  return {
    manager: new GlobalShortcutManager({ registrar, onActivate }),
    onActivate
  }
}

describe('GlobalShortcutManager', () => {
  test('registers the frozen default and routes activation', () => {
    const registrar = new FakeRegistrar()
    const { manager, onActivate } = createManager(registrar)

    expect(manager.register()).toEqual({
      accelerator: defaultCaptureShortcut,
      defaultAccelerator: defaultCaptureShortcut,
      registered: true,
      failure: null
    })
    registrar.activate(defaultCaptureShortcut)

    expect(onActivate).toHaveBeenCalledOnce()
    expect(registrar.calls).toEqual([`register:${defaultCaptureShortcut}`])
  })

  test('reports a registration conflict without claiming success', () => {
    const registrar = new FakeRegistrar()
    registrar.rejected.add(defaultCaptureShortcut)
    const { manager } = createManager(registrar)

    expect(manager.register()).toMatchObject({
      accelerator: defaultCaptureShortcut,
      registered: false,
      failure: 'conflict'
    })
  })

  test('registers and persists a candidate before unregistering the old key', async () => {
    const registrar = new FakeRegistrar()
    const timeline = registrar.calls
    const { manager } = createManager(registrar)
    const persist = (accelerator: string): void => {
      timeline.push(`persist:${accelerator}`)
    }
    manager.register()

    const status = await manager.reconfigure('Ctrl+Alt+N', persist)

    expect(status).toMatchObject({ accelerator: 'Ctrl+Alt+N', registered: true, failure: null })
    expect(timeline).toEqual([
      `register:${defaultCaptureShortcut}`,
      'register:Ctrl+Alt+N',
      'persist:Ctrl+Alt+N',
      `unregister:${defaultCaptureShortcut}`
    ])
  })

  test('keeps the old registration on invalid or conflicting candidates', async () => {
    const registrar = new FakeRegistrar()
    const persist = vi.fn()
    const { manager, onActivate } = createManager(registrar)
    manager.register()

    expect(await manager.reconfigure('Space', persist)).toMatchObject({
      accelerator: defaultCaptureShortcut,
      registered: true,
      failure: 'invalid'
    })

    registrar.rejected.add('Ctrl+Alt+N')
    expect(await manager.reconfigure('Ctrl+Alt+N', persist)).toMatchObject({
      accelerator: defaultCaptureShortcut,
      registered: true,
      failure: 'conflict'
    })
    registrar.activate(defaultCaptureShortcut)

    expect(onActivate).toHaveBeenCalledOnce()
    expect(persist).not.toHaveBeenCalled()
    expect(registrar.callbacks.has(defaultCaptureShortcut)).toBe(true)
  })

  test('rolls back the candidate when persistence fails', async () => {
    const registrar = new FakeRegistrar()
    const persistenceError = new Error('storage unavailable')
    const { manager, onActivate } = createManager(registrar)
    const persist = (): void => {
      throw persistenceError
    }
    manager.register()

    await expect(manager.reconfigure('Ctrl+Alt+N', persist)).rejects.toBe(persistenceError)

    expect(manager.getStatus()).toMatchObject({
      accelerator: defaultCaptureShortcut,
      registered: true,
      failure: null
    })
    expect(registrar.callbacks.has('Ctrl+Alt+N')).toBe(false)
    expect(registrar.callbacks.has(defaultCaptureShortcut)).toBe(true)
    registrar.activate(defaultCaptureShortcut)
    expect(onActivate).toHaveBeenCalledOnce()
  })

  test('dispose unregisters exactly once and suppresses future activation', () => {
    const registrar = new FakeRegistrar()
    const { manager, onActivate } = createManager(registrar)
    manager.register()

    manager.dispose()
    manager.dispose()
    registrar.activate(defaultCaptureShortcut)

    expect(registrar.calls).toEqual([
      `register:${defaultCaptureShortcut}`,
      `unregister:${defaultCaptureShortcut}`
    ])
    expect(manager.getStatus()).toMatchObject({ registered: false, failure: 'unavailable' })
    expect(onActivate).not.toHaveBeenCalled()
  })
})
