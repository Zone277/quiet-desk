import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bootstrap, callQuietDesk, cleanIsolatedRoot, expectOk, launchQuietDesk,
  makeIsolatedRoot, request, shiftDateOnly, zonedLocalToUtc } from './stage3-harness.mjs'
import { quitStage6 as closeQuietDesk } from './stage6-runtime.mjs'

const prefix = 'quietdesk-stage7-editor-'
const root = await makeIsolatedRoot(prefix)
const evidence = resolve('test-results/stage7', `editor-${Date.now()}`)
await mkdir(evidence, { recursive: true })
let runtime
try {
  runtime = await launchQuietDesk({ userData: root })
  const library = runtime.pages.get('library')
  const { currentDate, appTimeZone } = await bootstrap(library, 'library')
  const id = crypto.randomUUID()
  expectOk(await callQuietDesk(library, ['notes', 'create'], request({ id, title: 'Edit existing note',
    bodyMarkdown: 'Original body' }, { mutation: true })), 'note create')
  await library.locator(`[data-entity-id="${id}"]`).click()
  assert.equal(await library.getByTestId('entity-edit-open').count(), 1, 'saved entity has no editing entry')
  await library.getByTestId('entity-edit-open').click()
  await library.getByTestId('entity-edit-body').fill('# 修改 / Edited\n\n- [ ] still document only')
  await library.screenshot({ path: resolve(evidence, 'note-editor.png') })
  await library.getByTestId('entity-edit-save').click()
  await library.locator('.detail-column').getByText('修改 / Edited', { exact: true }).waitFor()
  const stored = expectOk(await callQuietDesk(library, ['notes', 'get'], request({ id })), 'edited note')
  assert.equal(stored.revision, 2)
  assert.equal(stored.bodyMarkdown, '# 修改 / Edited\n\n- [ ] still document only')
  // An actual external update advances SQLite revision while the editor remains open.
  await library.getByTestId('entity-edit-open').click()
  await library.getByTestId('entity-edit-body').fill('Preserve conflicting edit 中文')
  expectOk(await callQuietDesk(runtime.pages.get('capture'), ['notes', 'update'], request({
    id, expectedRevision: 2, title: 'External edit', bodyMarkdown: stored.bodyMarkdown
  }, { mutation: true })), 'external revision')
  await library.getByTestId('entity-edit-save').click()
  await library.getByTestId('entity-edit-error').waitFor()
  assert.equal(await library.getByTestId('entity-edit-body').inputValue(), 'Preserve conflicting edit 中文')
  await library.screenshot({ path: resolve(evidence, 'revision-conflict.png') })
  await library.getByTestId('entity-edit-cancel').click()

  const tomorrow = shiftDateOnly(currentDate, 1)
  const taskId = crypto.randomUUID()
  expectOk(await callQuietDesk(library, ['tasks', 'create'], request({ id: taskId,
    title: '可编辑任务', bodyMarkdown: 'Task body', planDate: currentDate, dueDate: tomorrow
  }, { mutation: true })), 'create editable task')
  await library.locator(`[data-entity-id="${taskId}"]`).click()
  await library.getByTestId('entity-edit-open').click()
  await library.getByTestId('entity-edit-plan-date').fill(tomorrow)
  await library.getByTestId('entity-edit-save').click()
  await library.getByTestId('entity-edit-body').waitFor({ state: 'detached' })
  const task = expectOk(await callQuietDesk(library, ['library', 'getEntity'], request({ type: 'task', id: taskId })), 'edited task').value
  assert.equal(task.planDate, tomorrow)
  assert.equal(task.dueDate, tomorrow)
  expectOk(await callQuietDesk(library, ['tasks', 'setCompletion'], request({ id: taskId,
    expectedRevision: task.revision, action: 'complete' }, { mutation: true })), 'complete task')
  await library.getByTestId('library-date').fill(tomorrow)
  await library.locator(`[data-entity-id="${taskId}"]`).click()
  await library.getByTestId('entity-task-reopen').click()
  await library.getByTestId('entity-task-reopen').waitFor({ state: 'detached' })
  assert.equal(expectOk(await callQuietDesk(library, ['library', 'getEntity'], request({ type: 'task', id: taskId })), 'reopened task').value.completedAtUtc, null)
  await library.getByTestId('library-today').click()
  for (const kind of ['all-day', 'timed']) {
    const scheduleId = crypto.randomUUID()
    const boundaries = kind === 'all-day' ? { kind, startDate: currentDate, endDateExclusive: tomorrow }
      : { kind, startAtUtc: zonedLocalToUtc(currentDate, 9, 0, appTimeZone), endAtUtc: zonedLocalToUtc(currentDate, 10, 0, appTimeZone) }
    expectOk(await callQuietDesk(library, ['schedules', 'create'], request({ id: scheduleId, title: `编辑 ${kind}`,
      bodyMarkdown: '', ...boundaries }, { mutation: true })), 'create editable schedule')
    await library.locator(`[data-entity-id="${scheduleId}"]`).click()
    await library.getByTestId('entity-edit-open').click()
    const end = kind === 'all-day' ? shiftDateOnly(currentDate, 2) : `${currentDate}T14:30`
    await library.getByTestId('entity-edit-end').fill(end)
    await library.getByTestId('entity-edit-save').click()
    await library.getByTestId('entity-edit-body').waitFor({ state: 'detached' })
    const edited = expectOk(await callQuietDesk(library, ['library', 'getEntity'], request({ type: 'schedule', id: scheduleId })), 'edited schedule').value
    assert.equal(edited.revision, 2)
    assert.equal(kind === 'all-day' ? edited.endDateExclusive : edited.endAtUtc,
      kind === 'all-day' ? end : zonedLocalToUtc(currentDate, 14, 30, appTimeZone))
  }
  await closeQuietDesk(runtime)
  runtime = await launchQuietDesk({ userData: root })
  const reopened = expectOk(await callQuietDesk(runtime.pages.get('library'), ['notes', 'get'], request({ id })), 'restart note')
  assert.equal(reopened.bodyMarkdown, stored.bodyMarkdown)
  console.info(`STAGE7_EDITOR_PASS ${JSON.stringify({ id, currentDate, userData: root, evidence,
    scope: 'real note/task/timed/all-day editing, conflict retention/cancel, historical reopen, restart' })}`)
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(root, prefix)
}
