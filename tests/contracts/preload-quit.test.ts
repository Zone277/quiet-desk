import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const state = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  return { ipc: Object.assign(new EventEmitter(), { invoke: vi.fn(), send: vi.fn() }), expose: vi.fn() }
})
vi.mock('electron', () => ({ ipcRenderer: state.ipc, contextBridge: { exposeInMainWorld: state.expose } }))
import '../../src/preload/index'
import type { QuietDeskApi } from '../../src/shared/ipc-contract'
import { QUIETDESK_CHANNELS } from '../../src/shared/ipc-channels'
beforeEach(() => { state.ipc.send.mockClear() })
afterEach(() => vi.unstubAllGlobals())

test('one window acknowledges quit only after all lifecycle subscribers succeed', async () => {
  const api = state.expose.mock.calls.find(call => call[0] === 'quietDesk')![1] as QuietDeskApi
  const removeA = api.app.subscribeQuitPreparation(async () => true)
  const removeB = api.app.subscribeQuitPreparation(async () => false)
  state.ipc.emit(QUIETDESK_CHANNELS.prepareQuit, {}, '20000000-0000-4000-8000-000000000001')
  for (let i = 0; i < 12; i++) await Promise.resolve()
  expect(state.ipc.send).toHaveBeenCalledTimes(1)
  expect(state.ipc.send).toHaveBeenCalledWith(QUIETDESK_CHANNELS.quitPrepared,
    { token: '20000000-0000-4000-8000-000000000001', ready: false })
  removeA(); removeB(); removeB()
})

test('quit freezes the whole document until matching cancellation, then unlocks every listener', async () => {
  const api = state.expose.mock.calls.find(call => call[0] === 'quietDesk')![1] as QuietDeskApi
  const html = { inert: false }
  vi.stubGlobal('document', { documentElement: html })
  const cancelled = vi.fn()
  const remove = api.app.subscribeQuitPreparation(async () => true, cancelled)
  const token = '20000000-0000-4000-8000-000000000002'
  state.ipc.emit(QUIETDESK_CHANNELS.prepareQuit, {}, token)
  for (let i = 0; i < 12; i++) await Promise.resolve()
  expect(html.inert).toBe(true)
  expect(state.ipc.send).toHaveBeenCalledTimes(1)
  state.ipc.emit(QUIETDESK_CHANNELS.cancelQuit, {}, '20000000-0000-4000-8000-000000000001')
  expect(html.inert).toBe(true); expect(cancelled).not.toHaveBeenCalled()
  state.ipc.emit(QUIETDESK_CHANNELS.cancelQuit, {}, token)
  expect(html.inert).toBe(false); expect(cancelled).toHaveBeenCalledTimes(1)
  remove()
})

test('cancelled pending callbacks cannot send an obsolete ready into a new quit attempt', async () => {
  const api = state.expose.mock.calls.find(call => call[0] === 'quietDesk')![1] as QuietDeskApi
  let release!: (ready: boolean) => void
  const remove = api.app.subscribeQuitPreparation(() => new Promise(resolve => { release = resolve }))
  const token = '20000000-0000-4000-8000-000000000003'
  state.ipc.emit(QUIETDESK_CHANNELS.prepareQuit, {}, token)
  expect(state.ipc.send).not.toHaveBeenCalled()
  state.ipc.emit(QUIETDESK_CHANNELS.cancelQuit, {}, token)
  release(true)
  for (let i = 0; i < 12; i++) await Promise.resolve()
  expect(state.ipc.send).not.toHaveBeenCalled()
  remove()
})
