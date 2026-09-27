import { expect, test, vi } from 'vitest'
const state = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  return { ipc: Object.assign(new EventEmitter(), { invoke: vi.fn(), send: vi.fn() }), expose: vi.fn() }
})
vi.mock('electron', () => ({ ipcRenderer: state.ipc, contextBridge: { exposeInMainWorld: state.expose } }))
import '../../src/preload/index'
import type { QuietDeskApi } from '../../src/shared/ipc-contract'
import { QUIETDESK_CHANNELS } from '../../src/shared/ipc-channels'

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
