// Reproducible acceptance demonstration, not ordinary-startup demo seeding.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { bootstrap, callQuietDesk, ensureBuilt, expectOk,
  launchQuietDesk, request } from './stage3-harness.mjs'
import { quitStage6 as closeQuietDesk } from './stage6-runtime.mjs'

await ensureBuilt()
const root = resolve('test-results/stage7', `演示 空格 ${Date.now()}`)
const userData = join(root, '独立 数据')
await mkdir(root, { recursive: true })
const A = '2026-09-21', B = '2026-09-22', C = '2026-09-23'
const title = '昨日待办 / Yesterday task'
const body = '# 中文 Markdown / English\n\n- [ ] 文档清单不是任务\n\n```ts\nconst greeting = "你好"\n```\n\n[普通链接](https://example.com)'
const pids = []
let runtime
async function start(date) {
  runtime = await launchQuietDesk({ userData, extraEnv: {
    QUIETDESK_TEST_NOW: `${date}T04:00:00.000Z`, QUIETDESK_TEST_TIME_ZONE: 'Asia/Shanghai'
  } })
  pids.push(runtime.runtime.pid)
  assert.equal((await bootstrap(runtime.pages.get('library'), 'library')).currentDate, date)
}
async function call(namespace, method, payload, mutation = false) {
  return expectOk(await callQuietDesk(runtime.pages.get('library'), [namespace, method],
    request(payload, { mutation })), `${namespace}.${method}`)
}
const has = (log, section, id) => log.autoItems.some(item => item.section === section && item.sourceEntityId === id)
try {
  await start(A)
  let task = await call('tasks', 'create', { id: crypto.randomUUID(), title,
    bodyMarkdown: '原计划与截止独立', planDate: A, dueDate: B }, true)
  const schedule = await call('schedules', 'create', { kind: 'timed', id: crypto.randomUUID(),
    title: '今日跨午夜安排 / Planned', bodyMarkdown: '仅计划，不代表参加',
    startAtUtc: '2026-09-22T15:30:00.000Z', endAtUtc: '2026-09-22T16:30:00.000Z' }, true)
  const note = await call('notes', 'create', { id: crypto.randomUUID(), title: '混排笔记', bodyMarkdown: body }, true)
  await closeQuietDesk(runtime)
  await start(B)
  assert.notEqual(pids[0], pids[1], 'demonstration did not restart Electron')
  assert.equal((await call('notes', 'get', { id: note.id })).bodyMarkdown, body)
  assert.equal((await call('library', 'getEntity', { type: 'task', id: task.id })).value.planDate, A)
  for (const date of [B, C]) {
    assert.ok((await call('library', 'getDay', { date })).schedules.some(item => item.schedule.id === schedule.id))
  }
  task = await call('tasks', 'setCompletion', { id: task.id, expectedRevision: task.revision, action: 'complete' }, true)
  const logA = await call('dailyLogs', 'get', { date: A })
  const logB = await call('dailyLogs', 'get', { date: B })
  assert.ok(has(logA, 'pending-at-boundary', task.id))
  assert.ok(has(logB, 'completed', task.id))
  await call('dailyLogs', 'saveManual', { date: A, expectedRevision: 0,
    manualMarkdown: `独立手写保留 ${title}` }, true)
  const trashed = await call('entities', 'trash', { entity: { type: 'task', id: task.id }, expectedRevision: task.revision }, true)
  for (const date of [A, B]) assert.equal((await call('dailyLogs', 'get', { date })).autoItems.some(item => item.sourceEntityId === task.id), false)
  task = (await call('entities', 'restore', { entity: { type: 'task', id: task.id }, expectedRevision: trashed.value.revision }, true)).value
  assert.ok(has(await call('dailyLogs', 'get', { date: A }), 'pending-at-boundary', task.id))
  const exportPath = join(root, '中文 导出.md')
  await runtime.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  assert.equal((await call('dailyLogs', 'export', { date: A })).status, 'saved')
  const exported = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(exportPath))
  assert.ok(exported.includes(body) && exported.includes(title))
  await runtime.pages.get('library').screenshot({ path: join(root, 'library-B.png') })
  await closeQuietDesk(runtime)
  await start(C)
  assert.ok(has(await call('dailyLogs', 'get', { date: A }), 'pending-at-boundary', task.id))
  assert.ok(has(await call('dailyLogs', 'get', { date: B }), 'completed', task.id))
  const deleted = await call('entities', 'trash', { entity: { type: 'task', id: task.id },
    expectedRevision: task.revision }, true)
  await call('entities', 'permanentlyDelete', { entity: { type: 'task', id: task.id },
    expectedRevision: deleted.value.revision, confirmedEntityId: task.id }, true)
  const purged = await call('dailyLogs', 'get', { date: A })
  assert.equal(purged.autoItems.some(item => item.sourceEntityId === task.id), false)
  assert.ok(purged.manualMarkdown.includes(title), 'independent manual supplement was erased')
  const afterPath = join(root, '删除后 导出.md')
  await runtime.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, afterPath)
  assert.equal((await call('dailyLogs', 'export', { date: A })).status, 'saved')
  assert.ok((await readFile(afterPath, 'utf8')).includes(body), 'unrelated Markdown note damaged')
  assert.equal(await readFile(exportPath, 'utf8'), exported, 'independent earlier copy changed')
  await writeFile(join(root, 'report.json'), JSON.stringify({ status: 'PASS', pids,
    runtime: runtime.runtime, days: [A, B, C], zone: 'Asia/Shanghai', userData, exportPath, afterPath,
    clock: 'injected development Clock; system time unchanged',
    desktop: 'forced development fallback; Win+D/coverage NOT_RUN',
    dialog: 'test override, not native-dialog acceptance', screenshotInspected: false }, null, 2), 'utf8')
  console.info(`STAGE7_DEMO_PASS ${root}`)
} finally {
  await closeQuietDesk(runtime)
}
