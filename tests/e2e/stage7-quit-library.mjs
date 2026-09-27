import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { bootstrap, cleanIsolatedRoot, launchQuietDesk, makeIsolatedRoot } from './stage3-harness.mjs'
import { quitStage6 } from './stage6-runtime.mjs'

const prefix = 'quietdesk-stage7-quit-library-'
const root = await makeIsolatedRoot(prefix)
let runtime
let database
try {
  runtime = await launchQuietDesk({ userData: root })
  const library = runtime.pages.get('library')
  const { currentDate } = await bootstrap(library, 'library')
  const input = library.getByTestId('daily-log-manual-input')
  await input.waitFor()
  database = new DatabaseSync(join(root, 'data', 'quietdesk.sqlite3'))
  // Real SQLite failure, not a successful mock response. Native error dialog is
  // captured diagnostically so it does not interrupt the user's desktop.
  database.exec("CREATE TRIGGER stage7_fail_manual BEFORE UPDATE OF manual_markdown ON daily_logs BEGIN SELECT RAISE(ABORT, 'stage7 real save fault'); END")
  await runtime.app.evaluate(({ dialog }) => {
    globalThis.stage7QuitErrors = 0
    dialog.showMessageBox = async () => { globalThis.stage7QuitErrors++; return { response: 0 } }
  })
  await input.fill('中文手写 / retained after failed quit')
  await runtime.app.evaluate(({ app }) => app.quit())
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await runtime.app.evaluate(() => globalThis.stage7QuitErrors)) break
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.equal(await runtime.app.evaluate(() => globalThis.stage7QuitErrors), 1,
    'Failed quit must be rejected and reported')
  assert.equal(runtime.app.process().exitCode, null)
  assert.equal(await input.inputValue(), '中文手写 / retained after failed quit')
  assert.equal(database.prepare('SELECT manual_markdown FROM daily_logs WHERE log_date = ?').get(currentDate).manual_markdown, '')
  database.exec('DROP TRIGGER stage7_fail_manual')
  await quitStage6(runtime)
  runtime = undefined
  assert.equal(database.prepare('SELECT manual_markdown FROM daily_logs WHERE log_date = ?').get(currentDate).manual_markdown,
    '中文手写 / retained after failed quit')
  console.info('STAGE7_QUIT_LIBRARY_FAIL_RETRY_PASS')
} finally {
  database?.exec('DROP TRIGGER IF EXISTS stage7_fail_manual')
  if (runtime) await quitStage6(runtime)
  database?.close()
  await cleanIsolatedRoot(root, prefix)
}
