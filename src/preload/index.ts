import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_SPIKE_CHANNELS, type DesktopSpikeApi } from '../shared/desktop-spike'
import { QUIETDESK_CHANNELS } from '../shared/ipc-channels'
import type {
  BootstrapRequest,
  ChangeEvent,
  CreateNoteRequest,
  GetNoteRequest,
  QuietDeskApi
} from '../shared/ipc-contract'

const desktopSpikeApi: DesktopSpikeApi = Object.freeze({
  getStatus: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.getStatus),
  retryHost: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.retryHost)
})

const quietDeskApi: QuietDeskApi = Object.freeze({
  app: Object.freeze({
    bootstrap: (request: BootstrapRequest) => ipcRenderer.invoke(QUIETDESK_CHANNELS.bootstrap, request)
  }),
  notes: Object.freeze({
    create: (request: CreateNoteRequest) => ipcRenderer.invoke(QUIETDESK_CHANNELS.createNote, request),
    get: (request: GetNoteRequest) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getNote, request)
  }),
  changes: Object.freeze({
    subscribe: (listener: (event: ChangeEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: ChangeEvent): void => listener(payload)
      ipcRenderer.on(QUIETDESK_CHANNELS.changed, handler)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        ipcRenderer.removeListener(QUIETDESK_CHANNELS.changed, handler)
      }
    }
  })
})

contextBridge.exposeInMainWorld('quietDesk', quietDeskApi)
contextBridge.exposeInMainWorld('quietDeskDesktopSpike', desktopSpikeApi)
