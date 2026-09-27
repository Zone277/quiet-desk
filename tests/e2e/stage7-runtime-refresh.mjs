import assert from 'node:assert/strict'
import { bootstrap, callQuietDesk, cleanIsolatedRoot, expectOk, launchQuietDesk,
  makeIsolatedRoot, request, shiftDateOnly, closeQuietDesk } from './stage3-harness.mjs'

const prefix = 'quietdesk-stage7-runtime-'
const root = await makeIsolatedRoot(prefix)
let runtime
try {
  // SystemClock consumes this process-local Date source. No system clock is changed.
  runtime = await launchQuietDesk({ userData: root, extraEnv: { QUIETDESK_TEST_NOW: '' } })
  const widget = runtime.pages.get('widget'), library = runtime.pages.get('library')
  const initial = await bootstrap(library, 'library')
  const next = shiftDateOnly(initial.currentDate, 1)
  expectOk(await callQuietDesk(library, ['tasks', 'create'], request({ id: crypto.randomUUID(),
    title: 'NEXT_DAY_VISIBLE', bodyMarkdown: '', planDate: next, dueDate: null }, { mutation: true })), 'future task')
  await widget.waitForFunction(() => !document.querySelector('[data-testid="current-task-list"]')?.textContent.includes('NEXT_DAY_VISIBLE'))
  const beforePid = runtime.runtime.pid
  await runtime.app.evaluate(({ powerMonitor }, instant) => {
    const RealDate = globalThis.Date
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [instant])) }
      static now() { return RealDate.parse(instant) }
    }
    powerMonitor.emit('resume') // Application event probe, not a real sleep/wake claim.
  }, `${next}T04:00:00.000Z`)
  await widget.waitForFunction(() => document.querySelector('[data-testid="current-task-list"]')?.textContent.includes('NEXT_DAY_VISIBLE'), null, { timeout: 5000 })
  await library.getByTestId('library-today').click()
  assert.equal(await library.getByTestId('library-date').inputValue(), next)
  assert.equal(await runtime.app.evaluate(() => process.pid), beforePid)
  console.info(`STAGE7_RUNTIME_REFRESH_PASS ${JSON.stringify({ pid: beforePid,
    days: [initial.currentDate, next], realSleep: 'NOT_RUN', systemClockModified: false })}`)
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(root, prefix)
}
