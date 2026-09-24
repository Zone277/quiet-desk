import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  bootstrap,
  callQuietDesk,
  cleanIsolatedRoot,
  closeQuietDesk,
  ensureBuilt,
  expectOk,
  installChangeProbe,
  launchQuietDesk,
  makeIsolatedRoot,
  readChangeProbe,
  request,
  shiftDateOnly
} from './stage3-harness.mjs'

const CAPTURE_ROOT_PREFIX = 'quietdesk-stage4-capture-'
const SHORTCUT_ROOT_PREFIX = 'quietdesk-stage4-shortcut-'
const QUICK_CAPTURE_DRAFT_ID = '10000000-0000-4000-8000-000000000001'
const DEFAULT_SHORTCUT = 'Ctrl+Shift+Space'
const FALLBACK_SHORTCUT = 'Ctrl+Alt+F11'
const PRIMARY_TITLE = '阶段四捕获 / Capture mixed 中文 English 🌙'
const CODE_SENTINEL = 'LIBRARY_ONLY_CODE_SENTINEL_7c66a3'
const ESC_SENTINEL = 'Esc 立即保存最新一行 / latest edit must persist'
const REMOTE_IMAGE_URL = 'https://127.0.0.1:9/quietdesk-stage4-remote.png'
const SAFE_URL = 'https://example.com/stage4?q=%E4%B8%AD%E6%96%87'

const primaryMarkdown = [
  '第一行：中英文 mixed input，emoji 🌙',
  '第二行：由 Enter 键创建。',
  '',
  '- [ ] Markdown 清单只是文档内容',
  '明天上午九点：时间文字仍是笔记内容',
  '- ~~GFM 删除线~~',
  '',
  '> 引用 / blockquote',
  '',
  '| 列 A | Column B |',
  '| --- | --- |',
  '| 中文 | English |',
  '',
  '```ts',
  `const marker = '${CODE_SENTINEL}'`,
  'console.log(marker)',
  '```',
  '',
  '<script>window.__quietDeskRawHtmlExecuted = true</script>',
  '<div id="quietdesk-raw-html-probe">raw html must not render</div>',
  '',
  `![tracking pixel](${REMOTE_IMAGE_URL})`,
  `[安全链接](${SAFE_URL})`,
  '[危险链接](javascript:alert(1))',
  '',
  'Esc flush sentinel'
].join('\n')
const submittedMarkdown = `${primaryMarkdown}\n${ESC_SENTINEL}`

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function browserWindowState(app, kind) {
  return await app.evaluate(({ BrowserWindow }, expectedKind) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL().includes(`${expectedKind}.html`)
    ))
    if (!window) return null
    return {
      visible: window.isVisible(),
      focused: window.isFocused(),
      destroyed: window.isDestroyed()
    }
  }, kind)
}

async function waitForWindowVisibility(runtime, kind, visible) {
  const page = runtime.pages.get(kind)
  await page.waitForFunction(
    async ({ expectedKind, expectedVisible }) => {
      const state = await window.quietDesk.app.bootstrap({
        requestId: crypto.randomUUID(),
        payload: { windowKind: expectedKind }
      })
      return state.ok && document.visibilityState === (expectedVisible ? 'visible' : 'hidden')
    },
    { expectedKind: kind, expectedVisible: visible },
    { timeout: 15_000 }
  ).catch(async () => {
    const state = await browserWindowState(runtime.app, kind)
    assert.equal(state?.visible, visible, `${kind} visibility did not become ${visible}`)
  })
  const state = await browserWindowState(runtime.app, kind)
  assert.equal(state?.visible, visible, `${kind} BrowserWindow visibility`)
}

async function hideCapture(runtime) {
  const capture = runtime.pages.get('capture')
  expectOk(
    await callQuietDesk(capture, ['windows', 'hide'], request({ target: 'capture' })),
    'hide Capture'
  )
  await waitForWindowVisibility(runtime, 'capture', false)
}

async function openCaptureFromWidget(runtime) {
  const widget = runtime.pages.get('widget')
  await widget.locator('[data-testid="open-capture"]').click()
  await waitForWindowVisibility(runtime, 'capture', true)
  await runtime.pages.get('capture').locator('[data-testid="capture-body"]').waitFor({ state: 'visible' })
}

async function getDraft(capture) {
  return expectOk(
    await callQuietDesk(capture, ['drafts', 'get'], request({ id: QUICK_CAPTURE_DRAFT_ID })),
    'read Quick Capture draft'
  )
}

async function widgetSnapshot(widget) {
  return expectOk(
    await callQuietDesk(widget, ['widget', 'getSnapshot'], request({})),
    'read Widget snapshot'
  )
}

async function daySnapshot(library, date) {
  return expectOk(
    await callQuietDesk(library, ['library', 'getDay'], request({ date })),
    `read Library day ${date}`
  )
}

async function waitForDraftState(capture, state) {
  await capture.locator(`[data-testid="draft-save-state"][data-state="${state}"]`)
    .waitFor({ state: 'visible', timeout: 15_000 })
}

async function assertNewestEditWinsWhileSaveIsInFlight(runtime) {
  const capture = runtime.pages.get('capture')
  const databasePath = join(runtime.userData, 'data', 'quietdesk.sqlite3')
  const lock = new DatabaseSync(databasePath)
  try {
    lock.exec('PRAGMA busy_timeout = 100')
    lock.exec('BEGIN IMMEDIATE')
    await capture.locator('[data-testid="capture-title"]').fill('草稿串行保存探测')
    const body = capture.locator('[data-testid="capture-body"]')
    await body.fill('旧快照不应覆盖新内容')
    await body.evaluate((element, latestValue) => {
      window.setTimeout(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(element, latestValue)
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: latestValue,
          inputType: 'insertText'
        }))
      }, 1_000)
    }, '较新快照必须最终落盘 / newest edit wins')
    // Do not inspect the transient `saving` label here: the synchronous SQLite busy wait
    // blocks Electron's main-process automation channel. The renderer timer still edits
    // while the first IPC write is in flight, and the persisted revision below is the oracle.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_300))
  } finally {
    try {
      lock.exec('ROLLBACK')
    } finally {
      lock.close()
    }
  }

  await waitForDraftState(capture, 'saved')
  const draft = await getDraft(capture)
  assert.ok(draft.revision >= 2, 'Edits made during an in-flight save were not persisted in a later revision')
  assert.equal(draft.payload.bodyMarkdown, '较新快照必须最终落盘 / newest edit wins')
  return draft.revision
}

async function assertDefaultMixedMultilineAndComposition(runtime) {
  const capture = runtime.pages.get('capture')
  const widget = runtime.pages.get('widget')
  await capture.locator('[data-testid="capture-kind"] button[aria-pressed="true"]').waitFor()
  assert.match(
    await capture.locator('[data-testid="capture-kind"] button[aria-pressed="true"]').textContent(),
    /笔记|Note/u,
    'Quick Capture did not default to Note'
  )

  const title = capture.locator('[data-testid="capture-title"]')
  const body = capture.locator('[data-testid="capture-body"]')
  await title.fill(PRIMARY_TITLE)
  await body.fill('第一行：中英文 mixed input，emoji 🌙')
  await body.press('Enter')
  await body.type('第二行：由 Enter 键创建。')
  assert.equal(
    await body.inputValue(),
    '第一行：中英文 mixed input，emoji 🌙\n第二行：由 Enter 键创建。',
    'Enter did not create a body newline'
  )

  await body.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '候选' }))
    element.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      isComposing: true
    }))
  })
  await capture.waitForTimeout(250)
  assert.equal((await widgetSnapshot(widget)).totals.recentNotes, 0, 'Simulated composition Ctrl+Enter submitted')
  assert.equal((await browserWindowState(runtime.app, 'capture'))?.visible, true)
  await body.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '候选词' }))
  })

  await body.fill(primaryMarkdown)
  await waitForDraftState(capture, 'saved')
  const draft = await getDraft(capture)
  assert.equal(draft.captureKind, 'note')
  assert.equal(draft.payload.kind, 'note')
  assert.equal(draft.payload.title, PRIMARY_TITLE)
  assert.equal(draft.payload.bodyMarkdown, primaryMarkdown)
  return draft
}

async function assertBlurDoesNotSubmitOrClear(runtime, expectedRevision) {
  const capture = runtime.pages.get('capture')
  const library = runtime.pages.get('library')
  await library.bringToFront()
  await library.waitForTimeout(250)

  assert.equal((await browserWindowState(runtime.app, 'capture'))?.visible, true, 'Capture hid on blur')
  assert.equal(await capture.locator('[data-testid="capture-title"]').inputValue(), PRIMARY_TITLE)
  assert.equal(await capture.locator('[data-testid="capture-body"]').inputValue(), primaryMarkdown)
  const draft = await getDraft(capture)
  assert.equal(draft.revision, expectedRevision)
  assert.equal((await widgetSnapshot(runtime.pages.get('widget'))).totals.recentNotes, 0, 'Blur submitted a Note')
}

async function assertMarkdownSecurity(runtime) {
  const capture = runtime.pages.get('capture')
  const remoteRequests = []
  const collectRemote = (requestEvent) => {
    if (requestEvent.url().includes('quietdesk-stage4-remote.png')) remoteRequests.push(requestEvent.url())
  }
  capture.on('request', collectRemote)
  try {
    await capture.getByRole('button', { name: '预览', exact: true }).click()
    const preview = capture.locator('[data-testid="markdown-view"]')
    await preview.locator('table').waitFor({ state: 'visible' })
    await preview.locator('pre code').waitFor({ state: 'visible' })
    assert.equal(await preview.locator('img').count(), 0, 'Markdown preview created a remote img element')
    assert.equal(await preview.locator('[data-testid="markdown-image-blocked"]').count(), 1)
    assert.equal(await preview.locator('script').count(), 0, 'Raw script entered the preview DOM')
    assert.equal(await preview.locator('#quietdesk-raw-html-probe').count(), 0, 'Raw HTML entered the preview DOM')
    assert.equal(
      await capture.evaluate(() => globalThis.__quietDeskRawHtmlExecuted),
      undefined,
      'Raw Markdown HTML executed'
    )
    await capture.waitForTimeout(250)
    assert.deepEqual(remoteRequests, [], 'Markdown preview requested a remote image')

    const safeLink = preview.getByRole('link', { name: '安全链接' })
    await safeLink.click()
    assert.match(capture.url(), /capture\.html/u, 'Safe link navigated the renderer')

    const dangerousLink = preview.locator('a').filter({ hasText: '危险链接' })
    assert.equal(await dangerousLink.count(), 1, 'Dangerous Markdown link was not rendered as inspectable text')
    assert.equal(await dangerousLink.getAttribute('href'), '', 'Dangerous Markdown link retained its URL')
    await dangerousLink.click()
    assert.match(capture.url(), /capture\.html/u, 'Dangerous link navigated the renderer')

    const safe = await callQuietDesk(capture, ['links', 'openExternal'], request({ url: SAFE_URL }))
    assert.equal(safe.ok, true, `HTTPS link was rejected: ${JSON.stringify(safe)}`)
    assert.equal(safe.value.opened, true)
    assert.equal(safe.value.url, SAFE_URL)

    for (const url of ['javascript:alert(1)', 'data:text/html,evil', 'file:///C:/Windows/win.ini', '/relative']) {
      const rejected = await callQuietDesk(capture, ['links', 'openExternal'], request({ url }))
      assert.equal(rejected.ok, false, `Dangerous URL was accepted: ${url}`)
      assert.equal(rejected.error.code, 'INVALID_REQUEST', `Unexpected error for ${url}`)
    }

    const widgetDenied = await callQuietDesk(
      runtime.pages.get('widget'),
      ['links', 'openExternal'],
      request({ url: SAFE_URL })
    )
    assert.equal(widgetDenied.ok, false)
    assert.equal(widgetDenied.error.code, 'FORBIDDEN')
  } finally {
    capture.off('request', collectRemote)
  }
}

async function assertEscReopenAndRestart(runtime, draftRevision, userData) {
  const capture = runtime.pages.get('capture')
  await capture.getByRole('button', { name: '源码', exact: true }).click()
  const body = capture.locator('[data-testid="capture-body"]')
  await body.fill(submittedMarkdown)
  await body.press('Escape')
  await waitForWindowVisibility(runtime, 'capture', false)

  const persisted = await getDraft(capture)
  assert.ok(persisted.revision > draftRevision, 'Esc did not persist the latest dirty edit')
  assert.equal(persisted.payload.bodyMarkdown, submittedMarkdown)

  await openCaptureFromWidget(runtime)
  assert.equal(await capture.locator('[data-testid="capture-title"]').inputValue(), PRIMARY_TITLE)
  assert.equal(await capture.locator('[data-testid="capture-body"]').inputValue(), submittedMarkdown)

  const oldPid = runtime.runtime.pid
  await closeQuietDesk(runtime)
  const restarted = await launchQuietDesk({
    userData,
    locale: 'zh-CN',
    extraEnv: {
      QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN: '1',
      QUIETDESK_TEST_FAIL_NEXT_CAPTURE_SUBMIT: '1'
    }
  })
  assert.notEqual(restarted.runtime.pid, oldPid, 'Capture restart reused the same Electron process')
  const restored = await getDraft(restarted.pages.get('capture'))
  assert.equal(restored.revision, persisted.revision)
  assert.equal(restored.payload.title, PRIMARY_TITLE)
  assert.equal(restored.payload.bodyMarkdown, submittedMarkdown)
  await waitForDraftState(restarted.pages.get('capture'), 'saved')
  assert.equal(await restarted.pages.get('capture').locator('[data-testid="capture-title"]').inputValue(), PRIMARY_TITLE)
  assert.equal(await restarted.pages.get('capture').locator('[data-testid="capture-body"]').inputValue(), submittedMarkdown)
  return restarted
}

async function assertRapidSubmitCrossWindowAndReading(runtime) {
  const capture = runtime.pages.get('capture')
  const widget = runtime.pages.get('widget')
  const library = runtime.pages.get('library')
  for (const page of [widget, library]) await installChangeProbe(page)

  await capture.locator('[data-testid="capture-body"]').press('Control+Enter')
  await capture.locator('[role="alert"]').filter({ hasText: /操作失败|Operation failed/u })
    .waitFor({ state: 'visible', timeout: 15_000 })
  assert.equal(
    (await browserWindowState(runtime.app, 'capture'))?.visible,
    true,
    'Capture hid after the injected submit failure'
  )
  assert.equal(await capture.locator('[data-testid="capture-title"]').inputValue(), PRIMARY_TITLE)
  assert.equal(await capture.locator('[data-testid="capture-body"]').inputValue(), submittedMarkdown)
  const failedDraft = await getDraft(capture)
  assert.equal(failedDraft.payload.title, PRIMARY_TITLE)
  assert.equal(failedDraft.payload.bodyMarkdown, submittedMarkdown)
  assert.equal((await widgetSnapshot(widget)).totals.recentNotes, 0, 'Failed submit created a Note')
  assert.equal(
    (await readChangeProbe(widget)).some((event) => event.topics.includes('notes')),
    false,
    'Failed submit broadcast a Note change'
  )

  await capture.locator('[data-testid="capture-body"]').evaluate((element) => {
    for (let index = 0; index < 2; index += 1) {
      element.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true
      }))
    }
  })
  await waitForWindowVisibility(runtime, 'capture', false)

  await widget.waitForFunction(() => document.querySelectorAll('[data-testid="recent-note-item"]').length === 1)
  await library.waitForFunction(() => document.querySelectorAll('[data-testid="library-note-list"] li').length === 1)
  const widgetEvents = await readChangeProbe(widget)
  const libraryEvents = await readChangeProbe(library)
  const submittedEvents = widgetEvents.filter((event) => (
    event.topics.includes('notes') && event.topics.includes('drafts')
  ))
  assert.equal(submittedEvents.length, 1, 'Rapid Ctrl+Enter emitted more than one submit change')
  assert.equal(
    libraryEvents.some((event) => event.eventId === submittedEvents[0].eventId),
    true,
    'Library did not receive the committed Capture change'
  )
  const noteReference = submittedEvents[0].entityRefs.find((reference) => reference.type === 'note')
  assert.ok(noteReference, 'Capture submit event did not identify the Note')

  const snapshot = await widgetSnapshot(widget)
  assert.equal(snapshot.totals.recentNotes, 1, 'Rapid Ctrl+Enter created duplicate Notes')
  assert.equal(snapshot.totals.currentTasks, 0, 'Markdown checklist created a Task')
  assert.equal(snapshot.totals.todaySchedules, 0, 'Natural-language date created a Schedule')
  assert.equal(snapshot.recentNotes[0].note.id, noteReference.id)
  assert.equal(snapshot.recentNotes[0].note.title, PRIMARY_TITLE)
  assert.equal(snapshot.recentNotes[0].note.bodyMarkdown, submittedMarkdown)
  assert.equal(snapshot.recentNotes[0].plainTextPreview.includes(CODE_SENTINEL), false)
  assert.ok(snapshot.recentNotes[0].plainTextPreview.length <= 280)
  assert.equal(await widget.locator('pre, table, [data-testid="markdown-view"]').count(), 0)
  assert.equal(await getDraft(capture), null, 'Submitted draft was not deleted')

  const currentDate = (await bootstrap(library, 'library')).currentDate
  const day = await daySnapshot(library, currentDate)
  const notes = day.notes.filter(({ note }) => note.id === noteReference.id)
  assert.equal(notes.length, 1, 'Library day contains a missing or duplicate submitted Note')
  const listItem = library.locator(`[data-testid="library-note-list"] [data-entity-id="${noteReference.id}"]`)
  await listItem.click()
  const detail = library.locator('.detail-column [data-testid="markdown-view"]')
  await detail.locator('table').waitFor({ state: 'visible' })
  assert.equal(await detail.locator('pre code').textContent().then((value) => value.includes(CODE_SENTINEL)), true)
  assert.equal(await detail.locator('img').count(), 0)
  assert.equal(await detail.locator('[data-testid="markdown-image-blocked"]').count(), 1)
  assert.equal(await detail.locator('script, #quietdesk-raw-html-probe').count(), 0)
  return { noteId: noteReference.id, currentDate }
}

async function assertCommittedContentAfterRestart(runtime, userData, { currentDate, noteId }) {
  const oldPid = runtime.runtime.pid
  await closeQuietDesk(runtime)
  const restarted = await launchQuietDesk({
    userData,
    locale: 'zh-CN',
    extraEnv: { QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN: '1' }
  })
  assert.notEqual(restarted.runtime.pid, oldPid, 'Post-submit restart reused the same Electron process')

  const capture = restarted.pages.get('capture')
  const widget = restarted.pages.get('widget')
  const library = restarted.pages.get('library')
  const snapshot = await widgetSnapshot(widget)
  assert.equal(snapshot.totals.recentNotes, 1, 'Created Note did not survive restart')
  const primary = snapshot.recentNotes.filter(({ note }) => note.id === noteId)
  assert.equal(primary.length, 1, 'Primary Capture Note is missing or duplicated after restart')
  assert.equal(primary[0].note.title, PRIMARY_TITLE)
  assert.equal(primary[0].note.bodyMarkdown, submittedMarkdown)

  const day = await daySnapshot(library, currentDate)
  assert.equal(day.notes.filter(({ note }) => note.id === noteId).length, 1)
  assert.equal(await getDraft(capture), null, 'Submitted draft reappeared after restart')
  await waitForDraftState(capture, 'unsaved')
  assert.equal(await capture.locator('[data-testid="capture-title"]').inputValue(), '')
  assert.equal(await capture.locator('[data-testid="capture-body"]').inputValue(), '')
  return restarted
}

async function assertExplicitCaptureTypes(runtime) {
  const capture = runtime.pages.get('capture')
  const widget = runtime.pages.get('widget')
  const library = runtime.pages.get('library')
  const currentDate = (await bootstrap(capture, 'capture')).currentDate
  const nextDate = shiftDateOnly(currentDate, 1)
  const afterNextDate = shiftDateOnly(currentDate, 2)

  await openCaptureFromWidget(runtime)
  await capture.getByRole('button', { name: '任务', exact: true }).click()
  await capture.locator('[data-testid="capture-title"]').fill('显式任务 / task')
  await capture.locator('[data-testid="capture-body"]').fill('- [ ] 这只是任务说明中的 Markdown 清单\n2026-12-31 不自动解析')
  await capture.locator('[data-testid="capture-plan-date"]').fill(currentDate)
  await capture.locator('[data-testid="capture-due-date"]').fill(nextDate)
  await capture.locator('[data-testid="capture-submit"]').click()
  await waitForWindowVisibility(runtime, 'capture', false)
  await widget.waitForFunction(() => document.querySelectorAll('[data-testid="current-task-item"]').length === 1)
  const widgetTask = (await widgetSnapshot(widget)).currentTasks[0].task
  assert.equal(widgetTask.title, '显式任务 / task')
  assert.equal(widgetTask.planDate, currentDate)
  assert.equal(widgetTask.dueDate, nextDate)
  assert.equal((await widgetSnapshot(widget)).totals.recentNotes, 1, 'Markdown checklist created an extra Note')

  await openCaptureFromWidget(runtime)
  await capture.getByRole('button', { name: '定时日程', exact: true }).click()
  await capture.locator('[data-testid="capture-title"]').fill('显式跨午夜日程')
  await capture.locator('[data-testid="capture-start"]').fill(`${currentDate}T23:30`)
  await capture.locator('[data-testid="capture-end"]').fill(`${nextDate}T00:30`)
  await capture.locator('[data-testid="capture-submit"]').click()
  await waitForWindowVisibility(runtime, 'capture', false)
  const timedToday = (await daySnapshot(library, currentDate)).schedules
    .find(({ schedule }) => schedule.title === '显式跨午夜日程')
  assert.ok(timedToday, 'Capture timed schedule missing from start date')
  assert.equal(timedToday.schedule.kind, 'timed')
  assert.equal(
    (await daySnapshot(library, nextDate)).schedules
      .some(({ schedule }) => schedule.id === timedToday.schedule.id),
    true,
    'Capture timed schedule missing from next date'
  )

  await openCaptureFromWidget(runtime)
  await capture.getByRole('button', { name: '全天日程', exact: true }).click()
  await capture.locator('[data-testid="capture-title"]').fill('显式多日全天日程')
  await capture.locator('[data-testid="capture-start"]').fill(currentDate)
  await capture.locator('[data-testid="capture-end"]').fill(afterNextDate)
  await capture.locator('[data-testid="capture-submit"]').click()
  await waitForWindowVisibility(runtime, 'capture', false)
  const allDayToday = (await daySnapshot(library, currentDate)).schedules
    .find(({ schedule }) => schedule.title === '显式多日全天日程')
  assert.ok(allDayToday, 'Capture all-day schedule missing from start date')
  assert.equal(allDayToday.schedule.kind, 'all-day')
  assert.equal(
    (await daySnapshot(library, nextDate)).schedules
      .some(({ schedule }) => schedule.id === allDayToday.schedule.id),
    true,
    'Capture all-day schedule missing from next date'
  )
  assert.equal(
    (await daySnapshot(library, afterNextDate)).schedules
      .some(({ schedule }) => schedule.id === allDayToday.schedule.id),
    false,
    'Capture all-day schedule appeared on exclusive end date'
  )
}

async function runCaptureFlow(root) {
  let runtime
  const processIds = []
  try {
    runtime = await launchQuietDesk({
      userData: root,
      locale: 'zh-CN',
      extraEnv: { QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN: '1' }
    })
    runtime.userData = root
    processIds.push(runtime.runtime.pid)
    const initial = await bootstrap(runtime.pages.get('capture'), 'capture')
    assert.equal(initial.contractVersion, 3)
    assert.equal(initial.stage, 4)
    await hideCapture(runtime)
    await openCaptureFromWidget(runtime)

    await assertNewestEditWinsWhileSaveIsInFlight(runtime)
    const draft = await assertDefaultMixedMultilineAndComposition(runtime)
    await assertBlurDoesNotSubmitOrClear(runtime, draft.revision)
    await assertMarkdownSecurity(runtime)
    runtime = await assertEscReopenAndRestart(runtime, draft.revision, root)
    runtime.userData = root
    processIds.push(runtime.runtime.pid)
    const submitted = await assertRapidSubmitCrossWindowAndReading(runtime)
    runtime = await assertCommittedContentAfterRestart(runtime, root, submitted)
    runtime.userData = root
    processIds.push(runtime.runtime.pid)
    await assertExplicitCaptureTypes(runtime)
    return { runtime: runtime.runtime, processIds, primaryNoteId: submitted.noteId }
  } finally {
    await closeQuietDesk(runtime)
  }
}

async function runShortcutConflictFlow(root) {
  let runtime
  const processIds = []
  try {
    runtime = await launchQuietDesk({
      userData: root,
      locale: 'zh-CN',
      extraEnv: {
        QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN: '1',
        QUIETDESK_TEST_OCCUPY_SHORTCUT: '1'
      }
    })
    processIds.push(runtime.runtime.pid)
    const widget = runtime.pages.get('widget')
    const capture = runtime.pages.get('capture')
    const library = runtime.pages.get('library')
    const conflicted = await bootstrap(widget, 'widget')
    assert.deepEqual(conflicted.captureShortcut, {
      accelerator: DEFAULT_SHORTCUT,
      defaultAccelerator: DEFAULT_SHORTCUT,
      registered: false,
      failure: 'conflict'
    })
    await widget.locator('[data-testid="shortcut-conflict"]').waitFor({ state: 'visible' })
    await library.locator('[data-testid="shortcut-conflict"]').waitFor({ state: 'visible' })
    await widget.locator('[data-testid="open-capture"]').waitFor({ state: 'visible' })
    await hideCapture(runtime)
    await openCaptureFromWidget(runtime)
    assert.equal((await browserWindowState(runtime.app, 'capture'))?.visible, true)
    await hideCapture(runtime)

    const shortcutInput = library.locator('[data-testid="shortcut-input"]')
    await shortcutInput.fill(FALLBACK_SHORTCUT)
    await library.locator('[data-testid="shortcut-save"]').click()
    await library.locator('[data-testid="shortcut-conflict"]').waitFor({ state: 'detached', timeout: 15_000 })
    const configured = expectOk(
      await callQuietDesk(library, ['shortcuts', 'get'], request({})),
      'read configured shortcut'
    )
    assert.deepEqual(configured, {
      accelerator: FALLBACK_SHORTCUT,
      defaultAccelerator: DEFAULT_SHORTCUT,
      registered: true,
      failure: null
    })
    await widget.locator('[data-testid="shortcut-conflict"]').waitFor({ state: 'detached', timeout: 15_000 })
    assert.equal(await widget.locator('[data-testid="open-capture"]').isVisible(), true)

    await closeQuietDesk(runtime)
    runtime = undefined
    runtime = await launchQuietDesk({
      userData: root,
      locale: 'zh-CN',
      extraEnv: { QUIETDESK_TEST_DISABLE_EXTERNAL_OPEN: '1' }
    })
    processIds.push(runtime.runtime.pid)
    const persisted = expectOk(
      await callQuietDesk(runtime.pages.get('library'), ['shortcuts', 'get'], request({})),
      'read persisted shortcut after restart'
    )
    assert.deepEqual(persisted, configured)
    return { processIds, configured }
  } finally {
    await closeQuietDesk(runtime)
  }
}

await ensureBuilt()
const captureRoot = await makeIsolatedRoot(CAPTURE_ROOT_PREFIX)
const shortcutRoot = await makeIsolatedRoot(SHORTCUT_ROOT_PREFIX)
const cleanup = []

try {
  const capture = await runCaptureFlow(captureRoot)
  const shortcut = await runShortcutConflictFlow(shortcutRoot)
  console.info(`STAGE4_CAPTURE_PASS ${JSON.stringify({
    electron: capture.runtime.electron,
    node: capture.runtime.node,
    sqlite: capture.runtime.sqlite,
    platform: capture.runtime.platform,
    captureProcessIds: capture.processIds,
    shortcutProcessIds: shortcut.processIds,
    primaryNoteId: capture.primaryNoteId,
    configuredShortcut: shortcut.configured,
    isolatedUserData: [captureRoot, shortcutRoot],
    sqliteWriteFailureSimulation: 'NOT_RUN: repeated GUI lock runs were unstable',
    deterministicSubmitFailure: 'PASS: one-shot isolated-test fault preserved content and retried successfully',
    automatedCompositionScope: 'DOM composition events only; real Windows IME remains NOT_RUN'
  })}`)
} catch (error) {
  console.error(`STAGE4_CAPTURE_FAIL ${JSON.stringify({
    captureRoot,
    shortcutRoot,
    message: error instanceof Error ? error.message : String(error)
  })}`)
  throw error
} finally {
  for (const [root, prefix] of [
    [captureRoot, CAPTURE_ROOT_PREFIX],
    [shortcutRoot, SHORTCUT_ROOT_PREFIX]
  ]) {
    await cleanIsolatedRoot(root, prefix)
    cleanup.push({ root, removed: process.env.QUIETDESK_KEEP_TEST_DATA === '1' ? false : !await exists(root) })
  }
  console.info(`STAGE4_QA_CLEANUP ${JSON.stringify(cleanup)}`)
}
