import type { Clock } from '../shared/clock'
import { dateInTimeZone } from '../shared/clock'
import { runtimeContextSchema, type RuntimeContext } from '../shared/ipc-contract'

// Runtime invalidation is not a fabricated committed data event. No persisted sequence.
export function createRuntimeRefresh(options: {
  clock: Clock; timeZone: string; resolvedTheme(): 'light' | 'dark'
  notify(context: RuntimeContext): void; reconcile(): void
}): { refresh(force?: boolean): void; dispose(): void } {
  const snapshot = (): RuntimeContext => runtimeContextSchema.parse({
    currentDate: dateInTimeZone(options.clock, options.timeZone), resolvedTheme: options.resolvedTheme()
  })
  let last = snapshot(), disposed = false
  const refresh = (force = false): void => {
    if (disposed) return
    const next = snapshot()
    const dateChanged = next.currentDate !== last.currentDate
    if (!force && !dateChanged && next.resolvedTheme === last.resolvedTheme) return
    if (dateChanged || force) options.reconcile()
    last = next
    options.notify(next)
  }
  const timer = setInterval(() => refresh(), 30_000)
  timer.unref()
  return { refresh, dispose: () => { disposed = true; clearInterval(timer) } }
}
