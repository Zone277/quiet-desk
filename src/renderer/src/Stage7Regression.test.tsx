import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapSnapshot, QuietDeskApi } from '../../shared/ipc-contract'
import type { ChangeEvent } from '../../shared/ipc-contract'
import { App } from './App'
import { CaptureView } from './CaptureView'
import { DailyLogPanel } from './DailyLogPanel'
import { HostBadge } from './HostBadge'
import { LibraryView } from './LibraryView'
import { WidgetView } from './WidgetView'
import { EntityEditor } from './EntityEditor'
import type { EntityRecord } from '../../shared/model'
import { copyFor } from './i18n'

// Node-only component probes: controlled hooks and IPC boundaries, NOT a DOM/Electron test.
const hooks = vi.hoisted(() => ({ current: undefined as Probe | undefined }))
interface Probe {
  slots: unknown[]; index: number; effects: (() => void)[]; cleanups: (() => void)[]
}
vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>()
  return { ...real,
    useState: (initial: unknown) => {
      const p = hooks.current!; const i = p.index++
      if (!(i in p.slots)) p.slots[i] = typeof initial === 'function' ? initial() : initial
      return [p.slots[i], (next: unknown) => { p.slots[i] = typeof next === 'function' ? next(p.slots[i]) : next }]
    },
    useRef: (initial: unknown) => {
      const p = hooks.current!; const i = p.index++
      if (!(i in p.slots)) p.slots[i] = { current: initial }
      return p.slots[i]
    },
    useCallback: (fn: unknown, deps: unknown[]) => {
      const p = hooks.current!; const i = p.index++
      const previous = p.slots[i] as { fn: unknown; deps: unknown[] } | undefined
      if (previous && previous.deps.length === deps.length && deps.every((x, n) => Object.is(x, previous.deps[n]))) return previous.fn
      p.slots[i] = { fn, deps }; return fn
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const p = hooks.current!; const i = p.index++
      const previous = p.slots[i] as { deps?: unknown[]; cleanup?: () => void } | undefined
      if (previous && deps && previous.deps?.length === deps.length && deps.every((x, n) => Object.is(x, previous.deps![n]))) return
      p.effects.push(() => {
        previous?.cleanup?.()
        const cleanup = fn() || undefined
        p.slots[i] = { deps, cleanup }
        if (cleanup) p.cleanups.push(cleanup)
      })
    }
  }
})

type NodeProps = Record<string, unknown> & { children?: unknown }
function nodes(tree: unknown): ReactElement<NodeProps>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const element = tree as ReactElement<NodeProps>
  return [element, ...nodes(element.props.children)]
}
function find(tree: unknown, id: string): ReactElement<NodeProps> {
  const element = nodes(tree).find((x) => x.props['data-testid'] === id)
  expect(element, `missing ${id}`).toBeDefined()
  return element!
}
function probe<P>(component: (props: P) => ReactElement, initial: P) {
  const p: Probe = { slots: [], index: 0, effects: [], cleanups: [] }
  let props = initial
  return {
    render(next?: P) {
      if (next) props = next
      p.index = 0; hooks.current = p
      const tree = component(props)
      hooks.current = undefined
      for (const effect of p.effects.splice(0)) effect()
      return tree
    },
    unmount() { for (const cleanup of p.cleanups) cleanup() }
  }
}
const drain = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
const copy = copyFor('en-US')
const bootstrap = { currentDate: '2026-09-26', appTimeZone: 'Asia/Shanghai', locale: 'en-US', theme: 'system', resolvedTheme: 'light',
  windowKind: 'library', dataRevision: 0, captureShortcut: { failure: null } } as BootstrapSnapshot
const note = { type: 'note', value: { id: '00000000-0000-4000-8000-000000000001', title: 'Existing', bodyMarkdown: 'Original', revision: 1, deletedAtUtc: null,
  createdAtUtc: '2026-09-26T04:00:00.000Z', updatedAtUtc: '2026-09-26T04:00:00.000Z' } }
const ok = (value: unknown) => ({ ok: true, requestId: crypto.randomUUID(), value })
const log = (date: string) => ({ id: note.value.id, logDate: date, manualMarkdown: '', manualRevision: 0, autoItems: [] })
let api: QuietDeskApi
let quit: (() => Promise<boolean>) | undefined
let runtime: (() => void) | undefined
let changed: ((event: ChangeEvent) => void) | undefined
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  quit = undefined; runtime = undefined
  api = {
    app: { bootstrap: vi.fn(async () => ok(bootstrap)), subscribeRuntime: vi.fn((listener) => { runtime = listener; return vi.fn() }),
      subscribeQuitPreparation: vi.fn((listener) => { quit = listener; return vi.fn() }) },
    changes: { subscribe: vi.fn((listener) => { changed = listener; return vi.fn() }) }, windows: { subscribeContext: vi.fn(() => vi.fn()), hide: vi.fn(async () => ok({})) },
    library: { getDay: vi.fn(async () => ok({ selectedDate: bootstrap.currentDate, tasks: [], schedules: [], notes: [{ note: note.value }] })),
      getEntity: vi.fn(async () => ok(note)), getHistory: vi.fn(async () => ok([])) },
    drafts: { get: vi.fn(async () => ({ ok: false, error: { code: 'NOT_FOUND' } })), save: vi.fn(async () => ok({ revision: 1 })), submit: vi.fn() },
    dailyLogs: { get: vi.fn(async (request) => ok(log(request.payload.date))), saveManual: vi.fn(async (request) => ok({ ...log(request.payload.date), manualMarkdown: request.payload.manualMarkdown, manualRevision: 1 })) },
    widget: { getSnapshot: vi.fn(async () => ok({ currentTasks: [], todaySchedules: [], recentNotes: [], completedToday: [], totals: {} })) }
  } as unknown as QuietDeskApi
  api.notes = { ...api.notes, update: vi.fn(async (request) => ok({ ...note.value, ...request.payload, revision: 2 })) } as unknown as QuietDeskApi['notes']
  api.tasks = { update: vi.fn(), reschedule: vi.fn(), setCompletion: vi.fn() } as unknown as QuietDeskApi['tasks']
  api.schedules = { update: vi.fn() } as unknown as QuietDeskApi['schedules']
  vi.stubGlobal('window', { quietDesk: api, innerHeight: 420, setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args), clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args), clearInterval: (...args: Parameters<typeof clearInterval>) => clearInterval(...args),
    quietDeskDesktopSpike: { getStatus: vi.fn(async () => ({ mode: 'desktop' })), retryHost: vi.fn(async () => ({ mode: 'fallback' })) } })
  vi.stubGlobal('document', { documentElement: { dataset: {}, lang: '' } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Stage7 renderer regressions (unit boundary only)', () => {
  it('opens an editor for an existing note', async () => {
    const view = probe(LibraryView, { bootstrap, copy }); view.render(); await drain()
    const item = nodes(view.render()).find((x) => x.props['data-entity-id'] === note.value.id)!
    await (item.props.onClick as () => Promise<void>)(); await drain()
    const body = nodes(view.render()).find((x) => typeof x.type === 'function' && x.type.name === 'EntityBody')!
    const detail = probe(body.type as (props: NodeProps) => ReactElement, body.props)
    find(detail.render(), 'entity-edit-open'); view.unmount(); detail.unmount()
  })
  it('subscribes runtime changes and refreshes bootstrap', async () => {
    const view = probe(App, { windowKind: 'widget' as const }); view.render(); await drain()
    expect(runtime).toBeTypeOf('function'); runtime!(); await drain()
    expect(api.app.bootstrap).toHaveBeenCalledTimes(2); view.unmount()
  })
  it('requeries Widget on currentDate change', async () => {
    const view = probe(WidgetView, { bootstrap, copy }); view.render(); await drain()
    const before = vi.mocked(api.widget.getSnapshot).mock.calls.length
    view.render({ bootstrap: { ...bootstrap, currentDate: '2026-09-27' }, copy }); await drain()
    expect(api.widget.getSnapshot).toHaveBeenCalledTimes(before + 1); view.unmount()
  })
  it('polls host status without OS mutations', async () => {
    vi.useFakeTimers()
    const view = probe(HostBadge, { copy }); view.render(); await drain()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(window.quietDeskDesktopSpike.getStatus).toHaveBeenCalledTimes(2); view.unmount()
  })
  it('flushes Capture before its debounce on quit, and rejects failed writes', async () => {
    const view = probe(CaptureView, { bootstrap, copy }); view.render(); await drain()
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: 'Latest input' } })
    expect(quit).toBeTypeOf('function'); expect(await quit!()).toBe(true)
    expect(api.drafts.save).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ payload: expect.objectContaining({ bodyMarkdown: 'Latest input' }) }) }))
    vi.mocked(api.drafts.save).mockResolvedValueOnce({ ok: false, requestId: crypto.randomUUID(), error: { code: 'STORAGE_ERROR', message: 'locked', retryable: true } })
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: 'Retain on failure' } })
    expect(await quit!()).toBe(false)
    expect(find(view.render(), 'capture-body').props.value).toBe('Retain on failure'); view.unmount()
  })
  it('flushes dirty Daily Log supplements for all cached dates on quit', async () => {
    const view = probe(DailyLogPanel, { date: '2026-09-26', locale: 'en-US' as const, copy, refreshToken: 0 }); view.render(); await drain()
    ;(find(view.render(), 'daily-log-manual-input').props.onChange as (event: unknown) => void)({ target: { value: 'Day A' } })
    view.render({ date: '2026-09-27', locale: 'en-US', copy, refreshToken: 0 }); await drain()
    ;(find(view.render(), 'daily-log-manual-input').props.onChange as (event: unknown) => void)({ target: { value: 'Day B' } })
    expect(quit).toBeTypeOf('function'); expect(await quit!()).toBe(true)
    expect(api.dailyLogs.saveManual).toHaveBeenCalledTimes(2); view.unmount()
  })
  it('does not apply a delayed clean read after a newer edit has been saved', async () => {
    const view = probe(CaptureView, { bootstrap, copy }); view.render(); await drain()
    const delayed = deferred<Awaited<ReturnType<QuietDeskApi['drafts']['get']>>>()
    vi.mocked(api.drafts.get).mockImplementationOnce(() => delayed.promise)
    changed!({ topics: ['drafts'] } as ChangeEvent); await drain()
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: 'New durable body' } })
    const save = nodes(view.render()).find((x) => x.type === 'button' && x.props.children === copy.save)!
    ;(save.props.onClick as () => void)(); await drain()
    delayed.resolve({ ok: true, requestId: crypto.randomUUID(), value: { id: note.value.id, captureKind: 'note', revision: 1,
      createdAtUtc: note.value.createdAtUtc, updatedAtUtc: note.value.updatedAtUtc, savedAtUtc: note.value.updatedAtUtc, payload: { kind: 'note', title: '', bodyMarkdown: 'Stale r1' } } })
    await drain()
    expect(find(view.render(), 'capture-body').props.value).toBe('New durable body'); view.unmount()
  })
  it('does not cross-submit while Esc save-and-hide is pending', async () => {
    const view = probe(CaptureView, { bootstrap, copy }); view.render(); await drain()
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: 'Pending' } })
    const delayed = deferred<Awaited<ReturnType<QuietDeskApi['drafts']['save']>>>()
    vi.mocked(api.drafts.save).mockImplementationOnce(() => delayed.promise)
    ;(find(view.render(), 'capture-close').props.onClick as () => void)()
    ;(find(view.render(), 'capture-submit').props.onClick as () => void)()
    delayed.resolve({ ok: true, requestId: crypto.randomUUID(), value: { revision: 1 } } as Awaited<ReturnType<QuietDeskApi['drafts']['save']>>)
    await drain()
    expect(api.drafts.submit).not.toHaveBeenCalled(); view.unmount()
  })
  it('keeps oversize input visible with an explicit error and no write', async () => {
    const view = probe(CaptureView, { bootstrap, copy }); view.render(); await drain()
    const text = 'x'.repeat(1_000_001)
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: text } })
    const save = nodes(view.render()).find((x) => x.type === 'button' && x.props.children === copy.save)!
    ;(save.props.onClick as () => void)(); await drain()
    expect(find(view.render(), 'capture-body').props.value).toBe(text)
    find(view.render(), 'capture-length-error')
    expect(api.drafts.save).not.toHaveBeenCalled(); view.unmount()
  })
  it('ignores reversed detail reads and clears deleted selected content', async () => {
    const view = probe(LibraryView, { bootstrap, copy }); view.render(); await drain()
    const a = deferred<Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>>()
    const b = deferred<Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>>()
    vi.mocked(api.library.getDay).mockResolvedValue(ok({ selectedDate: bootstrap.currentDate, tasks: [], schedules: [], notes: [
      { note: note.value }, { note: { ...note.value, id: '00000000-0000-4000-8000-000000000002' } } ] }) as Awaited<ReturnType<QuietDeskApi['library']['getDay']>>)
    changed!({ topics: ['notes'], entityRefs: [] } as unknown as ChangeEvent); await drain()
    vi.mocked(api.library.getEntity).mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
    const buttons = nodes(view.render()).filter((x) => x.props['data-entity-id'])
    ;(buttons[0]!.props.onClick as () => void)(); (buttons[1]!.props.onClick as () => void)()
    const recordB = { ...note, value: { ...note.value, id: '00000000-0000-4000-8000-000000000002', title: 'B' } }
    b.resolve(ok(recordB) as Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>); await drain()
    a.resolve(ok(note) as Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>); await drain()
    const body = nodes(view.render()).find((x) => typeof x.type === 'function' && x.type.name === 'EntityBody')!
    expect((body.props.record as typeof note).value.title).toBe('B')
    vi.mocked(api.library.getEntity).mockResolvedValue({ ok: false, requestId: crypto.randomUUID(), error: { code: 'NOT_FOUND', message: 'deleted', retryable: false } })
    changed!({ topics: ['notes'], entityRefs: [{ type: 'note', id: recordB.value.id }] } as unknown as ChangeEvent); await drain()
    expect(nodes(view.render()).some((x) => typeof x.type === 'function' && x.type.name === 'EntityBody')).toBe(false); view.unmount()
  })
  it('follows today across midnight but preserves an explicitly selected old day', async () => {
    const view = probe(LibraryView, { bootstrap, copy }); view.render(); await drain()
    view.render({ bootstrap: { ...bootstrap, currentDate: '2026-09-27' }, copy }); await drain()
    expect(find(view.render(), 'library-date').props.value).toBe('2026-09-27')
    ;(find(view.render(), 'library-date').props.onChange as (event: unknown) => void)({ target: { value: '2026-09-20' } })
    view.render({ bootstrap: { ...bootstrap, currentDate: '2026-09-28' }, copy }); await drain()
    expect(find(view.render(), 'library-date').props.value).toBe('2026-09-20'); view.unmount()
  })
  it('invalidates a detail read on mode switch', async () => {
    const view = probe(LibraryView, { bootstrap, copy }); view.render(); await drain()
    const delayed = deferred<Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>>()
    vi.mocked(api.library.getEntity).mockImplementationOnce(() => delayed.promise)
    api.library.listTrash = vi.fn(async () => ({ ok: true as const, requestId: crypto.randomUUID(), value: [] }))
    const item = nodes(view.render()).find((x) => x.props['data-entity-id'] === note.value.id)!
    ;(item.props.onClick as () => void)()
    ;(find(view.render(), 'trash-open').props.onClick as () => void)()
    delayed.resolve(ok(note) as Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>); await drain()
    const dayButton = nodes(view.render()).find((x) => x.type === 'button' && x.props.children === copy.browseDate)!
    ;(dayButton.props.onClick as () => void)(); view.render(); await drain()
    expect(nodes(view.render()).some((x) => typeof x.type === 'function' && x.type.name === 'EntityBody')).toBe(false); view.unmount()
  })
  it('ignores an older host response after retry and clears the interval on unmount', async () => {
    vi.useFakeTimers()
    const delayed = deferred<Awaited<ReturnType<typeof window.quietDeskDesktopSpike.getStatus>>>()
    vi.mocked(window.quietDeskDesktopSpike.getStatus).mockImplementationOnce(() => delayed.promise)
    const view = probe(HostBadge, { copy }); view.render()
    ;(find(view.render(), 'host-mode').props.onClick as () => void)(); await drain()
    delayed.resolve({ mode: 'desktop' } as Awaited<ReturnType<typeof window.quietDeskDesktopSpike.getStatus>>); await drain()
    expect(find(view.render(), 'host-mode').props['data-mode']).toBe('fallback')
    view.unmount(); await vi.advanceTimersByTimeAsync(20_000)
    expect(window.quietDeskDesktopSpike.getStatus).toHaveBeenCalledTimes(1)
  })
  it('awaits pending Capture submit before quit without claiming success on failed flush', async () => {
    const view = probe(CaptureView, { bootstrap, copy }); view.render(); await drain()
    ;(find(view.render(), 'capture-body').props.onChange as (event: unknown) => void)({ target: { value: 'Pending submission' } })
    const delayed = deferred<Awaited<ReturnType<QuietDeskApi['drafts']['submit']>>>()
    vi.mocked(api.drafts.submit).mockImplementationOnce(() => delayed.promise)
    ;(find(view.render(), 'capture-submit').props.onClick as () => void)(); await drain()
    let completed = false
    const pendingQuit = quit!().then((result) => { completed = true; return result })
    await drain(); expect(completed).toBe(false)
    delayed.resolve({ ok: false, requestId: crypto.randomUUID(), error: { code: 'STORAGE_ERROR', message: 'failed', retryable: true } })
    expect(await pendingQuit).toBe(true) // Failed formal submission, but its draft was successfully persisted.
    expect(find(view.render(), 'capture-body').props.value).toBe('Pending submission'); view.unmount()
  })
  it('blocks quit when a cached Daily Log date conflicts', async () => {
    const view = probe(DailyLogPanel, { date: '2026-09-26', locale: 'en-US' as const, copy, refreshToken: 0 }); view.render(); await drain()
    ;(find(view.render(), 'daily-log-manual-input').props.onChange as (event: unknown) => void)({ target: { value: 'Keep this' } })
    vi.mocked(api.dailyLogs.saveManual).mockResolvedValue({ ok: false, requestId: crypto.randomUUID(), error: { code: 'CONFLICT', message: 'revision', retryable: true } })
    expect(await quit!()).toBe(false)
    find(view.render(), 'daily-log-quit-error')
    expect(find(view.render(), 'daily-log-manual-input').props.value).toBe('Keep this'); view.unmount()
  })
  it('reopens a selected historical completed task through the existing revision command', async () => {
    const task = { type: 'task' as const, value: { ...note.value, planDate: '2026-09-20', dueDate: null, completedAtUtc: '2026-09-20T04:00:00.000Z' } }
    vi.mocked(api.library.getDay).mockResolvedValue(ok({ selectedDate: '2026-09-20', tasks: [{ task: task.value, matchReasons: ['completed'] }], schedules: [], notes: [] }) as Awaited<ReturnType<QuietDeskApi['library']['getDay']>>)
    vi.mocked(api.library.getEntity).mockResolvedValue(ok(task) as Awaited<ReturnType<QuietDeskApi['library']['getEntity']>>)
    vi.mocked(api.tasks.setCompletion).mockResolvedValue(ok({ ...task.value, revision: 2, completedAtUtc: null }) as Awaited<ReturnType<QuietDeskApi['tasks']['setCompletion']>>)
    const view = probe(LibraryView, { bootstrap, copy }); view.render(); await drain()
    ;(find(view.render(), 'library-date').props.onChange as (event: unknown) => void)({ target: { value: '2026-09-20' } })
    view.render(); await drain()
    const item = nodes(view.render()).find((x) => x.props['data-entity-id'] === task.value.id)!
    ;(item.props.onClick as () => void)(); await drain()
    ;(find(view.render(), 'entity-task-reopen').props.onClick as () => void)(); await drain()
    expect(api.tasks.setCompletion).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: task.value.id, expectedRevision: 1, action: 'reopen' } })); view.unmount()
  })
  it('releases App runtime, change and Capture quit subscriptions on unmount', async () => {
    const runtimeOff = vi.fn(); const changesOff = vi.fn(); const quitOff = vi.fn()
    vi.mocked(api.app.subscribeRuntime).mockReturnValue(runtimeOff)
    vi.mocked(api.changes.subscribe).mockReturnValue(changesOff)
    vi.mocked(api.app.subscribeQuitPreparation).mockReturnValue(quitOff)
    const app = probe(App, { windowKind: 'capture' as const }); app.render(); await drain(); app.unmount()
    const capture = probe(CaptureView, { bootstrap, copy }); capture.render(); await drain(); capture.unmount()
    expect(runtimeOff).toHaveBeenCalledTimes(1); expect(changesOff).toHaveBeenCalledTimes(2); expect(quitOff).toHaveBeenCalledTimes(1)
  })
})

describe('existing entity editor command boundary (not persistence evidence)', () => {
  const props = (record: EntityRecord) => ({ record, bootstrap, copy, onSaved: vi.fn(), onCancel: vi.fn(), onBlockedChange: vi.fn() })
  const change = (view: ReturnType<typeof probe>, id: string, value: string) => {
    ;(find(view.render(), id).props.onChange as (event: unknown) => void)({ target: { value } })
  }
  const save = async (view: ReturnType<typeof probe>) => { (find(view.render(), 'entity-edit-save').props.onClick as () => void)(); await drain() }
  it('updates note title/Markdown with the opened revision and never converts a checklist', async () => {
    const callbacks = props(note as EntityRecord)
    const view = probe(EntityEditor, callbacks); view.render()
    change(view, 'entity-edit-title', '修改 / Edited')
    change(view, 'entity-edit-body', '# 文本\n- [ ] document only')
    await save(view)
    expect(api.notes.update).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: note.value.id, expectedRevision: 1, title: '修改 / Edited', bodyMarkdown: '# 文本\n- [ ] document only' } }))
    expect(api.tasks.update).not.toHaveBeenCalled(); expect(callbacks.onSaved).toHaveBeenCalledTimes(1); view.unmount()
  })
  it('preserves conflict input, blocks quit, and cancel performs no further mutation', async () => {
    const callbacks = props(note as EntityRecord)
    const view = probe(EntityEditor, callbacks); view.render()
    change(view, 'entity-edit-body', 'Retain edits')
    vi.mocked(api.notes.update).mockResolvedValue({ ok: false, requestId: crypto.randomUUID(), error: { code: 'CONFLICT', message: 'revision changed', retryable: true } })
    await save(view)
    expect(find(view.render(), 'entity-edit-body').props.value).toBe('Retain edits')
    expect(await quit!()).toBe(false); find(view.render(), 'entity-edit-error')
    ;(find(view.render(), 'entity-edit-cancel').props.onClick as () => void)()
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1); expect(api.notes.update).toHaveBeenCalledTimes(1); expect(callbacks.onSaved).not.toHaveBeenCalled(); view.unmount()
  })
  it('reschedules dates separately and uses update for combined task content edits', async () => {
    const task = { type: 'task' as const, value: { ...note.value, planDate: '2026-09-26', dueDate: '2026-09-27', completedAtUtc: null } }
    vi.mocked(api.tasks.reschedule).mockResolvedValue(ok(task.value) as Awaited<ReturnType<QuietDeskApi['tasks']['reschedule']>>)
    vi.mocked(api.tasks.update).mockResolvedValue(ok(task.value) as Awaited<ReturnType<QuietDeskApi['tasks']['update']>>)
    const view = probe(EntityEditor, props(task)); view.render()
    change(view, 'entity-edit-plan-date', '2026-09-29'); change(view, 'entity-edit-due-date', '')
    await save(view)
    expect(api.tasks.reschedule).toHaveBeenCalledWith(expect.objectContaining({ payload: { id: note.value.id, expectedRevision: 1, planDate: '2026-09-29', dueDate: null } }))
    view.unmount()
    const combined = probe(EntityEditor, props(task)); combined.render()
    change(combined, 'entity-edit-body', 'Edited details'); change(combined, 'entity-edit-due-date', '2026-09-30')
    await save(combined)
    expect(api.tasks.update).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ expectedRevision: 1, bodyMarkdown: 'Edited details', planDate: '2026-09-26', dueDate: '2026-09-30' }) })); combined.unmount()
  })
  it('preserves unchanged UTC seconds and converts edited timed bounds using app timezone', async () => {
    const timed = { type: 'schedule' as const, value: { ...note.value, kind: 'timed' as const, startAtUtc: '2026-09-26T04:00:12.123Z', endAtUtc: '2026-09-26T05:00:45.000Z' } }
    vi.mocked(api.schedules.update).mockResolvedValue(ok(timed.value) as Awaited<ReturnType<QuietDeskApi['schedules']['update']>>)
    const view = probe(EntityEditor, props(timed)); view.render()
    change(view, 'entity-edit-title', 'Changed title'); change(view, 'entity-edit-end', '2026-09-26T14:30')
    await save(view)
    expect(api.schedules.update).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ kind: 'timed', startAtUtc: timed.value.startAtUtc, endAtUtc: '2026-09-26T06:30:00.000Z' }) })); view.unmount()
  })
  it('validates all-day exclusive bounds using the frozen schema without writing invalid input', async () => {
    const schedule = { type: 'schedule' as const, value: { ...note.value, kind: 'all-day' as const, startDate: '2026-09-26', endDateExclusive: '2026-09-28' } }
    vi.mocked(api.schedules.update).mockResolvedValue(ok(schedule.value) as Awaited<ReturnType<QuietDeskApi['schedules']['update']>>)
    const view = probe(EntityEditor, props(schedule)); view.render()
    change(view, 'entity-edit-end', '2026-09-26'); await save(view)
    find(view.render(), 'entity-edit-error'); expect(api.schedules.update).not.toHaveBeenCalled()
    change(view, 'entity-edit-end', '2026-09-29'); await save(view)
    expect(api.schedules.update).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ kind: 'all-day', startDate: '2026-09-26', endDateExclusive: '2026-09-29' }) })); view.unmount()
  })
})
