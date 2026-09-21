import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const apiAllowlist = Object.freeze({
  app: ['bootstrap'],
  changes: ['subscribe'],
  drafts: ['get', 'save'],
  entities: ['permanentlyDelete', 'restore', 'trash'],
  library: ['getDay', 'getEntity', 'getHistory', 'listTrash'],
  notes: ['create', 'get', 'update'],
  schedules: ['create', 'update'],
  settings: ['updateAppearance'],
  tasks: ['create', 'reschedule', 'setCompletion', 'update'],
  widget: ['getSnapshot'],
  windows: ['hide', 'show', 'subscribeContext']
})

export const requiredCapabilities = Object.freeze(
  Object.entries(apiAllowlist)
    .flatMap(([namespace, methods]) => methods.map((method) => `${namespace}.${method}`))
    .sort()
)

export const widgetSelectors = Object.freeze({
  currentTasks: 'section[aria-labelledby="current-tasks-heading"]',
  todaySchedules: 'section[aria-labelledby="today-schedule-heading"]',
  recentNotes: 'section[aria-labelledby="recent-notes-heading"]',
  captureEntry: '[data-testid="open-capture"]',
  dateBrowserEntry: '[data-testid="widget-date"]',
  completedToggle: '[data-testid="completed-today-toggle"]',
  currentTaskItems: '[data-testid="current-task-list"] [data-testid="current-task-item"]',
  currentTaskOverflow: 'section[aria-labelledby="current-tasks-heading"] [data-testid="section-more-count"]'
})

export function shiftDateOnly(dateOnly, days) {
  const instant = new Date(`${dateOnly}T12:00:00.000Z`)
  assert.equal(Number.isFinite(instant.getTime()), true, `Invalid date-only value: ${dateOnly}`)
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}

function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant)
  return Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]))
}

export function zonedLocalToUtc(dateOnly, hour, minute, timeZone) {
  const [year, month, day] = dateOnly.split('-').map(Number)
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let candidate = targetWallTime

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timeZone)
    const representedWallTime = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      0
    )
    const delta = targetWallTime - representedWallTime
    candidate += delta
    if (delta === 0) break
  }

  const verified = zonedParts(new Date(candidate), timeZone)
  assert.deepEqual(
    [verified.year, verified.month, verified.day, verified.hour, verified.minute],
    [year, month, day, hour, minute],
    `Unable to map ${dateOnly} ${hour}:${minute} in ${timeZone}`
  )
  return new Date(candidate).toISOString()
}

export async function ensureBuilt() {
  try {
    await access(join(projectRoot, 'out', 'main', 'index.js'))
  } catch {
    throw new Error('Built Electron entry is missing. Run `npm run build` before this script.')
  }
}

export async function makeIsolatedRoot(prefix) {
  return await mkdtemp(join(tmpdir(), prefix))
}

export async function cleanIsolatedRoot(root, prefix) {
  if (process.env.QUIETDESK_KEEP_TEST_DATA === '1') {
    console.info(`STAGE3_QA_TEST_DATA_RETAINED ${root}`)
    return
  }

  const resolvedRoot = resolve(root)
  const resolvedTemp = resolve(tmpdir())
  const expectedPrefix = resolve(tmpdir(), prefix)
  const relativePath = relative(resolvedTemp, resolvedRoot)
  if (!resolvedRoot.startsWith(expectedPrefix) || relativePath.startsWith('..')) {
    throw new Error(`Refusing to remove unexpected test path: ${resolvedRoot}`)
  }
  await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

async function collectThreeWindows(app) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const byKind = new Map()
    for (const page of app.windows()) {
      try {
        await page.locator('html[data-window-kind]').waitFor({ state: 'attached', timeout: 500 })
        const kind = await page.locator('html[data-window-kind]').getAttribute('data-window-kind')
        if (kind === 'widget' || kind === 'capture' || kind === 'library') byKind.set(kind, page)
      } catch {
        // A page can be observed before its renderer entry has attached.
      }
    }
    if (byKind.size === 3) return byKind
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Expected Widget, Capture and Library; observed ${app.windows().length} Electron pages`)
}

export async function launchQuietDesk({ userData, locale = 'zh-CN' }) {
  const environment = {
    ...process.env,
    QUIETDESK_TEST_USER_DATA: userData,
    QUIETDESK_FORCE_FALLBACK: '1',
    QUIETDESK_SHOW_ALL_WINDOWS: '1'
  }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_RENDERER_URL

  const app = await electron.launch({
    args: [`--lang=${locale}`, projectRoot],
    cwd: projectRoot,
    env: environment,
    timeout: 30_000
  })

  try {
    const pages = await collectThreeWindows(app)
    for (const page of pages.values()) {
      await page.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor({ timeout: 15_000 })
    }
    const runtime = await app.evaluate(() => ({
      pid: process.pid,
      electron: process.versions.electron,
      node: process.versions.node,
      sqlite: process.versions.sqlite,
      platform: process.platform
    }))
    return { app, pages, runtime }
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

export async function closeQuietDesk(runtime) {
  await runtime?.app.close().catch(() => undefined)
}

export async function callQuietDesk(page, path, request) {
  const outcome = await page.evaluate(async ({ path: methodPath, request: value }) => {
    try {
      let target = window.quietDesk
      for (const segment of methodPath) target = target?.[segment]
      if (typeof target !== 'function') {
        return { invocation: 'missing', message: `window.quietDesk.${methodPath.join('.')} is not a function` }
      }
      return { invocation: 'returned', value: await target(value) }
    } catch (error) {
      return {
        invocation: 'threw',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }, { path, request })

  if (outcome.invocation !== 'returned') {
    throw new Error(
      `IPC ${path.join('.')} ${outcome.invocation} instead of returning the contract IpcResult: ${outcome.message}`
    )
  }
  return outcome.value
}

export function expectOk(result, label) {
  assert.equal(result?.ok, true, `${label} failed: ${JSON.stringify(result)}`)
  return result.value
}

export function request(payload, { mutation = false, idempotencyKey } = {}) {
  return {
    requestId: crypto.randomUUID(),
    ...(mutation ? { idempotencyKey: idempotencyKey ?? crypto.randomUUID() } : {}),
    payload
  }
}

export async function bootstrap(page, windowKind) {
  return expectOk(
    await callQuietDesk(page, ['app', 'bootstrap'], request({ windowKind })),
    `${windowKind} bootstrap`
  )
}

export async function assertSecurityBoundary(runtime) {
  const expectedTopLevel = Object.keys(apiAllowlist).sort()

  for (const [kind, page] of runtime.pages) {
    const boundary = await page.evaluate(() => ({
      process: typeof globalThis.process,
      require: typeof globalThis.require,
      Buffer: typeof globalThis.Buffer,
      module: typeof globalThis.module,
      namespaces: Object.fromEntries(
        Object.entries(window.quietDesk).map(([name, value]) => [name, Object.keys(value).sort()])
      )
    }))
    assert.deepEqual(
      {
        process: boundary.process,
        require: boundary.require,
        Buffer: boundary.Buffer,
        module: boundary.module
      },
      { process: 'undefined', require: 'undefined', Buffer: 'undefined', module: 'undefined' },
      `${kind} renderer exposes a Node global`
    )
    assert.deepEqual(Object.keys(boundary.namespaces).sort(), expectedTopLevel, `${kind} preload namespaces differ`)
    for (const [namespace, methods] of Object.entries(apiAllowlist)) {
      assert.deepEqual(boundary.namespaces[namespace], methods, `${kind} ${namespace} API differs`)
    }
  }

  const preferences = await runtime.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    url: window.webContents.getURL(),
    preferences: window.webContents.getLastWebPreferences()
  })))
  assert.equal(preferences.length, 3)
  for (const item of preferences) {
    assert.equal(item.preferences.contextIsolation, true, `${item.url} contextIsolation`)
    assert.equal(item.preferences.sandbox, true, `${item.url} sandbox`)
    assert.equal(item.preferences.nodeIntegration, false, `${item.url} nodeIntegration`)
  }
}

export async function installChangeProbe(page) {
  await page.evaluate(() => {
    window.__quietDeskStage3Unsubscribe?.()
    window.__quietDeskStage3Events = []
    window.__quietDeskStage3Unsubscribe = window.quietDesk.changes.subscribe((event) => {
      window.__quietDeskStage3Events.push(event)
    })
  })
}

export async function readChangeProbe(page) {
  return await page.evaluate(() => [...(window.__quietDeskStage3Events ?? [])])
}

export async function waitForEntityEvent(page, { type, id, minimumSequence = 1 }) {
  await page.waitForFunction(
    ({ expectedType, expectedId, sequence }) => (window.__quietDeskStage3Events ?? []).some((event) => (
      event.sequence >= sequence &&
      event.entityRefs.some((reference) => reference.type === expectedType && reference.id === expectedId)
    )),
    { expectedType: type, expectedId: id, sequence: minimumSequence },
    { timeout: 15_000 }
  )
}

export async function setWidgetContentSize(app, width, height) {
  const result = await app.evaluate(({ BrowserWindow }, size) => {
    const widget = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('widget.html'))
    if (!widget) throw new Error('Widget BrowserWindow not found')
    widget.setContentSize(size.width, size.height, false)
    return {
      contentSize: widget.getContentSize(),
      contentBounds: widget.getContentBounds(),
      bounds: widget.getBounds()
    }
  }, { width, height })
  const [actualWidth, actualHeight] = result.contentSize
  assert.ok(
    actualWidth >= width && actualWidth <= width + 1 &&
    actualHeight >= height && actualHeight <= height + 1,
    `Widget content size ${actualWidth}x${actualHeight} differs by more than the one-DIP Windows rounding allowance from ${width}x${height}`
  )
  return result
}

export async function assertCoreEntriesInViewport(page) {
  const result = await page.evaluate((selectors) => {
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth
    }
    const entries = Object.fromEntries(
      ['currentTasks', 'todaySchedules', 'recentNotes', 'captureEntry'].map((name) => {
        const element = document.querySelector(selectors[name])
        if (!element) return [name, null]
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return [name, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          display: style.display,
          visibility: style.visibility
        }]
      })
    )
    return { viewport, entries }
  }, widgetSelectors)

  assert.ok(result.viewport.scrollWidth <= result.viewport.width, 'Widget has horizontal overflow')
  for (const [name, rect] of Object.entries(result.entries)) {
    assert.ok(rect, `Missing core Widget entry: ${name}`)
    assert.notEqual(rect.display, 'none', `${name} is display:none`)
    assert.notEqual(rect.visibility, 'hidden', `${name} is visibility:hidden`)
    assert.ok(rect.right > 0 && rect.left < result.viewport.width, `${name} is outside the horizontal viewport`)
    assert.ok(
      rect.bottom > 0 && rect.top < result.viewport.height,
      `${name} is outside the vertical viewport: ${JSON.stringify({ viewport: result.viewport, rect })}`
    )
  }
  return result
}
