import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'C:\\QuietDesk-test' }
}))
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

import { createDesktopHostAdapter } from '../../src/main/platform/desktop-host'

// Adapter contract tests only: no Electron process, HWND or Shell operation.
class TestPipe extends EventEmitter {
  setEncoding = vi.fn(() => this)
}

class TestChild extends EventEmitter {
  stdout = new TestPipe()
  stderr = new TestPipe()
  kill = vi.fn(() => true)

  complete(success: boolean, exitCode = 0, error?: string): void {
    this.stdout.emit('data', JSON.stringify({
      action: 'detach', success, parentHandle: '0x0', styleHex: '0x80000000',
      wallpaperRefresh: success ? 'reloaded-from-settings' : undefined, error
    }))
    if (exitCode !== 0 && error) this.stderr.emit('data', error)
    this.emit('close', exitCode)
  }
}

const bridgeScriptPath = 'C:\\QuietDesk-test\\windows_desktop_host.exe'
const handle = '123456'
const children: TestChild[] = []

function childAt(index: number): TestChild {
  const child = children[index]
  if (!child) throw new Error(`Expected helper invocation ${index + 1}`)
  return child
}

function adapter() {
  const result = createDesktopHostAdapter({ forceFallback: false, bridgeScriptPath })
  expect(result.kind).toBe('windows-win32-helper')
  return result
}

function expectInvocations(count: number): void {
  expect(mocks.spawn).toHaveBeenCalledTimes(count)
  for (let index = 1; index <= count; index++) {
    expect(mocks.spawn).toHaveBeenNthCalledWith(index, bridgeScriptPath,
      ['detach', handle, String(process.pid)], {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      })
  }
  for (const child of children) expect(child.kill).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  children.length = 0
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = new TestChild()
    children.push(child)
    return child
  })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe.skipIf(process.platform !== 'win32')('Desktop host detach retry (no GUI)', () => {
  test('first-attempt success invokes the helper once without a retry warning', async () => {
    const pending = adapter().detach(handle)
    childAt(0).complete(true)
    await expect(pending).resolves.toBeUndefined()
    expectInvocations(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  test.each([
    { name: 'nonzero exit', exitCode: 1 },
    { name: 'success=false with exit zero', exitCode: 0 }
  ])('retries $name once and succeeds', async ({ exitCode }) => {
    const pending = adapter().detach(handle)
    childAt(0).complete(false, exitCode, 'first refresh failed')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2))
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('QUIETDESK_DESKTOP_DETACH_RETRY',
      expect.objectContaining({ message: expect.stringContaining('first refresh failed') }))
    childAt(1).complete(true)
    await expect(pending).resolves.toBeUndefined()
    expectInvocations(2)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  test.each([
    { name: 'nonzero exits', exitCode: 1 },
    { name: 'success=false responses', exitCode: 0 }
  ])('rejects after two consecutive $name without a third invocation', async ({ exitCode }) => {
    const pending = adapter().detach(handle)
    const rejection = expect(pending).rejects.toThrow('second refresh failed')
    childAt(0).complete(false, exitCode, 'first refresh failed')
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2))
    childAt(1).complete(false, exitCode, 'second refresh failed')
    await rejection
    expectInvocations(2)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('QUIETDESK_DESKTOP_DETACH_RETRY',
      expect.objectContaining({ message: expect.stringContaining('first refresh failed') }))
    expect(console.info).not.toHaveBeenCalled()
  })
})
