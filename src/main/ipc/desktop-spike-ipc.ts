import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_SPIKE_CHANNELS } from '../../shared/desktop-spike'
import type { DesktopSpikeController } from '../windows/desktop-spike-window'

function assertTrustedSender(event: IpcMainInvokeEvent, controller: DesktopSpikeController): void {
  if (event.sender !== controller.window.webContents) {
    throw new Error('Rejected desktop-spike IPC from an untrusted webContents')
  }
}

export function registerDesktopSpikeIpc(controllerPromise: Promise<DesktopSpikeController>): void {
  ipcMain.removeHandler(DESKTOP_SPIKE_CHANNELS.getStatus)
  ipcMain.removeHandler(DESKTOP_SPIKE_CHANNELS.retryHost)

  ipcMain.handle(DESKTOP_SPIKE_CHANNELS.getStatus, async (event) => {
    const controller = await controllerPromise
    assertTrustedSender(event, controller)
    return controller.getStatus()
  })

  ipcMain.handle(DESKTOP_SPIKE_CHANNELS.retryHost, async (event) => {
    const controller = await controllerPromise
    assertTrustedSender(event, controller)
    return controller.retryHost('renderer-request')
  })
}
