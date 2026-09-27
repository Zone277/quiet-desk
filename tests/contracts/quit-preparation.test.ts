import { afterEach, expect, test, vi } from 'vitest'
import type { QuietDeskWindows } from '../../src/main/ipc/window-registry'
import { QUIETDESK_CHANNELS } from '../../src/shared/ipc-channels'

const state = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  return { ipc: new EventEmitter() }
})
vi.mock('electron', () => ({ ipcMain: state.ipc }))
import { createQuitPreparation } from '../../src/main/ipc/quit-preparation'

afterEach(() => { state.ipc.removeAllListeners(); vi.useRealTimers() })
function fixture() {
  const windows = Object.fromEntries(['widget', 'capture', 'library'].map((kind, index) => [kind, {
    isDestroyed: () => false,
    webContents: { id: index + 1, mainFrame: {}, send: vi.fn() }
  }])) as unknown as QuietDeskWindows
  return { windows, controller: createQuitPreparation(windows) }
}
test('quit waits for both registered main frames, rejects spoof/stale/extra fields, and removes listener', async () => {
  const { windows, controller } = fixture()
  const ready = controller.prepare()
  let finished = false
  void ready.then(() => { finished = true })
  const token = vi.mocked(windows.capture.webContents.send).mock.calls[0]![1]
  const answer = (sender: typeof windows.capture.webContents, payload: unknown, frame: unknown = sender.mainFrame) =>
    state.ipc.emit(QUIETDESK_CHANNELS.quitPrepared, { sender, senderFrame: frame }, payload)
  answer(windows.widget.webContents, { token, ready: true })
  answer(windows.capture.webContents, { token, ready: true }, {})
  answer(windows.capture.webContents, { token, ready: true, path: 'forbidden' })
  await Promise.resolve()
  expect(finished).toBe(false)
  answer(windows.capture.webContents, { token, ready: true })
  await Promise.resolve()
  expect(finished).toBe(false)
  answer(windows.library.webContents, { token, ready: true })
  await expect(ready).resolves.toBe(true)
  controller.dispose()
  expect(state.ipc.listenerCount(QUIETDESK_CHANNELS.quitPrepared)).toBe(0)
})
test('failed save and no-ack timeout block exit instead of destroying input', async () => {
  vi.useFakeTimers()
  const { windows, controller } = fixture()
  const failed = controller.prepare()
  const token = vi.mocked(windows.capture.webContents.send).mock.calls[0]![1]
  state.ipc.emit(QUIETDESK_CHANNELS.quitPrepared, { sender: windows.capture.webContents,
    senderFrame: windows.capture.webContents.mainFrame }, { token, ready: false })
  await expect(failed).resolves.toBe(false)
  for (const window of [windows.capture, windows.library]) {
    expect(window.webContents.send).toHaveBeenCalledWith(QUIETDESK_CHANNELS.cancelQuit, token)
  }
  const timeout = controller.prepare()
  const timedToken = vi.mocked(windows.capture.webContents.send).mock.calls.at(-1)![1]
  vi.advanceTimersByTime(10_000)
  await expect(timeout).resolves.toBe(false)
  expect(windows.capture.webContents.send).toHaveBeenCalledWith(QUIETDESK_CHANNELS.cancelQuit, timedToken)
  controller.dispose()
})
