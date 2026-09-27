import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { cleanIsolatedRoot, launchQuietDesk, makeIsolatedRoot, projectRoot } from './stage3-harness.mjs'

const prefix = 'quietdesk-stage7-quit-'
const root = await makeIsolatedRoot(prefix)
let runtime
try {
  runtime = await launchQuietDesk({ userData: root })
  const capture = runtime.pages.get('capture')
  const editor = capture.locator('[data-testid="capture-body"]')
  await editor.waitFor()
  await editor.fill('退出前未去抖 / unsaved at explicit quit')
  const process = runtime.app.process()
  const exit = runtime.app.waitForEvent('close', { timeout: 15_000 })
  await runtime.app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await exit
  assert.equal(process.exitCode, 0)
  runtime = undefined
  const database = new DatabaseSync(join(root, 'data', 'quietdesk.sqlite3'))
  try {
    const drafts = database.prepare('SELECT payload_json FROM drafts').all()
    assert.ok(drafts.some(draft => JSON.parse(draft.payload_json).bodyMarkdown === '退出前未去抖 / unsaved at explicit quit'),
      'Explicit quit lost the latest pre-debounce Capture text')
  } finally { database.close() }
  console.info('STAGE7_QUIT_DRAFT_PASS')
} finally {
  await runtime?.app.close().catch(() => undefined)
  await cleanIsolatedRoot(root, prefix)
}
