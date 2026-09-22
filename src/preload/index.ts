import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_SPIKE_CHANNELS, type DesktopSpikeApi } from '../shared/desktop-spike'
import { QUIETDESK_CHANNELS } from '../shared/ipc-channels'
import type { ChangeEvent, QuietDeskApi, WindowOpenContext } from '../shared/ipc-contract'

const desktopSpikeApi: DesktopSpikeApi = Object.freeze({
  getStatus: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.getStatus),
  retryHost: () => ipcRenderer.invoke(DESKTOP_SPIKE_CHANNELS.retryHost)
})

const quietDeskApi: QuietDeskApi = {
  app: {
    bootstrap: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.bootstrap, request)
  },
  widget: {
    getSnapshot: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.widgetSnapshot, request)
  },
  library: {
    getDay: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.daySnapshot, request),
    getEntity: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getEntity, request),
    getHistory: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getHistory, request),
    listTrash: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.listTrash, request)
  },
  tasks: {
    create: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.createTask, request),
    update: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.updateTask, request),
    setCompletion: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.setTaskCompletion, request),
    reschedule: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.rescheduleTask, request)
  },
  notes: {
    create: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.createNote, request),
    get: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getNote, request),
    update: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.updateNote, request)
  },
  schedules: {
    create: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.createSchedule, request),
    update: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.updateSchedule, request)
  },
  drafts: {
    get: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getDraft, request),
    save: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.saveDraft, request),
    submit: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.submitDraft, request)
  },
  entities: {
    trash: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.trashEntity, request),
    restore: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.restoreEntity, request),
    permanentlyDelete: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.permanentlyDeleteEntity, request)
  },
  settings: {
    updateAppearance: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.updateAppearance, request)
  },
  shortcuts: {
    get: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.getShortcut, request),
    update: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.updateShortcut, request)
  },
  links: {
    openExternal: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.openExternal, request)
  },
  windows: {
    show: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.showWindow, request),
    hide: (request) => ipcRenderer.invoke(QUIETDESK_CHANNELS.hideWindow, request),
    subscribeContext: (listener: (context: WindowOpenContext) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WindowOpenContext): void => listener(payload)
      ipcRenderer.on(QUIETDESK_CHANNELS.windowContext, handler)
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        ipcRenderer.removeListener(QUIETDESK_CHANNELS.windowContext, handler)
      }
    }
  },
  changes: {
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
  }
}

for (const namespace of Object.values(quietDeskApi)) Object.freeze(namespace)
Object.freeze(quietDeskApi)

contextBridge.exposeInMainWorld('quietDesk', quietDeskApi)
contextBridge.exposeInMainWorld('quietDeskDesktopSpike', desktopSpikeApi)
