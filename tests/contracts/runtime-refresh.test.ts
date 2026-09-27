import { afterEach, expect, test, vi } from 'vitest'
import { createRuntimeRefresh } from '../../src/main/runtime-refresh'

afterEach(() => vi.useRealTimers())

test('injected Clock advances in one process; resume/theme refresh without entity mutations', () => {
  vi.useFakeTimers()
  let now = new Date('2026-09-21T15:59:59.999Z')
  let theme: 'light' | 'dark' = 'light'
  const notify = vi.fn(), reconcile = vi.fn()
  const controller = createRuntimeRefresh({ clock: { now: () => now }, timeZone: 'Asia/Shanghai',
    resolvedTheme: () => theme, notify, reconcile })
  vi.advanceTimersByTime(30_000)
  expect(notify).not.toHaveBeenCalled()
  now = new Date('2026-09-21T16:00:00.000Z')
  vi.advanceTimersByTime(30_000)
  expect(notify).toHaveBeenLastCalledWith({ currentDate: '2026-09-22', resolvedTheme: 'light' })
  expect(reconcile).toHaveBeenCalledTimes(1)
  theme = 'dark'
  controller.refresh()
  expect(notify).toHaveBeenLastCalledWith({ currentDate: '2026-09-22', resolvedTheme: 'dark' })
  controller.refresh(true)
  expect(reconcile).toHaveBeenCalledTimes(2)
  const count = notify.mock.calls.length
  controller.dispose()
  now = new Date('2026-09-23T04:00:00.000Z')
  vi.advanceTimersByTime(60_000)
  controller.refresh(true)
  expect(notify).toHaveBeenCalledTimes(count)
})
