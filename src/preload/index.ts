import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_SPIKE_CHANNELS, type DesktopSpikeApi } from '../shared/desktop-spike'

const desktopSpikeApi: DesktopSpikeApi = Object.freeze({
  getStatus: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.getStatus),
  retryHost: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.retryHost)
})

contextBridge.exposeInMainWorld('quietDeskDesktopSpike', desktopSpikeApi)
