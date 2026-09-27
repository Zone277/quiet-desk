import { ipcMain, type IpcMainEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { QUIETDESK_CHANNELS } from '../../shared/ipc-channels'
import type { QuietDeskWindows } from './window-registry'

const answerSchema = z.object({ token: z.string().uuid(), ready: z.boolean() }).strict()

export function createQuitPreparation(windows: QuietDeskWindows): {
  prepare(): Promise<boolean>; dispose(): void
} {
  let pending: { token: string; waiting: Set<number>; finish(ready: boolean): void } | undefined
  const onAnswer = (event: IpcMainEvent, raw: unknown): void => {
    const parsed = answerSchema.safeParse(raw)
    if (!parsed.success || !pending || parsed.data.token !== pending.token) return
    if (event.senderFrame !== event.sender.mainFrame || !pending.waiting.has(event.sender.id)) return
    if (!parsed.data.ready) { pending.finish(false); return }
    pending.waiting.delete(event.sender.id)
    if (pending.waiting.size === 0) pending.finish(true)
  }
  ipcMain.on(QUIETDESK_CHANNELS.quitPrepared, onAnswer)
  return {
    prepare: () => new Promise<boolean>((resolve) => {
      if (pending) { resolve(false); return }
      const required = [windows.capture, windows.library].filter(window => !window.isDestroyed())
      if (required.length === 0) { resolve(true); return }
      const timer = setTimeout(() => pending?.finish(false), 10_000)
      pending = { token: randomUUID(), waiting: new Set(required.map(window => window.webContents.id)),
        finish: (ready) => { clearTimeout(timer); pending = undefined; resolve(ready) } }
      for (const window of required) window.webContents.send(QUIETDESK_CHANNELS.prepareQuit, pending.token)
    }),
    dispose: () => {
      pending?.finish(false)
      ipcMain.off(QUIETDESK_CHANNELS.quitPrepared, onAnswer)
    }
  }
}
