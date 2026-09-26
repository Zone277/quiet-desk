import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, join, dirname, basename } from 'node:path'
import assert from 'node:assert/strict'
import { launchStage6, quitStage6 } from '../tests/e2e/stage6-runtime.mjs'

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(`test-results/stage6/原生 交互 ${Date.now()}`)
assert.equal(dirname(root), resolve('test-results/stage6'))
assert.match(basename(root), /^原生 交互 \d+$/u)
await mkdir(root, { recursive: true })
const runtime = await launchStage6(root, { executablePath: resolve('test-results/stage6/发布 验证/应用 含空格/QuietDesk.exe') })
const evidence = { runtime: runtime.runtime, root, events: [], scope: 'native input diagnostic session; no automatic IME verdict' }
const capture = runtime.pages.get('capture')
capture.on('console', message => {
  if (message.text().startsWith('NATIVE_INPUT ')) { evidence.events.push(message.text()); console.info(message.text()) }
})
await capture.evaluate(() => {
  for (const type of ['compositionstart', 'compositionend', 'keydown']) document.addEventListener(type, event => {
    console.info(`NATIVE_INPUT ${JSON.stringify({ type, key: event.key, isComposing: event.isComposing, data: event.data })}`)
  }, true)
})
console.info(`STAGE6_MANUAL_READY ${JSON.stringify({ root, runtime: runtime.runtime })}`)
const deadline = Date.now() + 300000
try {
  while (Date.now() < deadline) {
    if (await access(join(root, 'finish')).then(() => true, () => false)) break
    await new Promise(done => setTimeout(done, 1000))
  }
  evidence.finalSnapshot = await runtime.pages.get('library').evaluate(() => window.quietDesk.widget.getSnapshot({ requestId: crypto.randomUUID(), payload: {} }))
  const visible = await runtime.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(window => window.isVisible()).map(window => window.webContents.getURL()))
  for (const [kind, page] of runtime.pages) {
    if (visible.includes(page.url())) await page.screenshot({ path: join(root, `${kind}-final.png`), timeout: 10000 })
  }
  if (process.argv[2]) assert.equal(evidence.finalSnapshot.value.recentNotes[0]?.note.bodyMarkdown, '你\nn English / 中文')
  console.info('STAGE6_MANUAL_SESSION_COMPLETED')
} catch (error) {
  evidence.harnessError = error.stack || String(error)
  throw error
} finally {
  await quitStage6(runtime)
  await writeFile(join(root, process.argv[2] ? 'evidence-restart.json' : 'evidence.json'), JSON.stringify(evidence, null, 2), 'utf8')
}
