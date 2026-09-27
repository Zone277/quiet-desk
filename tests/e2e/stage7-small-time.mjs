import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { bootstrap, callQuietDesk, cleanIsolatedRoot, closeQuietDesk, expectOk,
  launchQuietDesk, makeIsolatedRoot, request, shiftDateOnly, zonedLocalToUtc } from './stage3-harness.mjs'
const prefix = 'quietdesk-stage7-small-time-'
const root = await makeIsolatedRoot(prefix)
const evidence = resolve('test-results/stage7', `small-time-${Date.now()}`)
await mkdir(evidence, { recursive: true })
let runtime
try {
  runtime = await launchQuietDesk({ userData: root })
  const widget = runtime.pages.get('widget'), library = runtime.pages.get('library')
  const { currentDate, appTimeZone } = await bootstrap(library, 'library')
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [index, id] of ids.entries()) expectOk(await callQuietDesk(library, ['schedules', 'create'], request({
    id, title: `完整日程时间 / Full arrangement ${index}`, bodyMarkdown: '',
    kind: 'all-day', startDate: currentDate, endDateExclusive: shiftDateOnly(currentDate, 1)
  }, { mutation: true })), 'real schedule')
  await runtime.app.evaluate(({ BrowserWindow }) => {
    const widget = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('widget.html'))
    widget.setContentSize(320, 240)
  })
  for (const kind of ['all-day', 'timed']) {
  if (kind === 'timed') {
    for (const id of ids) expectOk(await callQuietDesk(library, ['entities', 'trash'], request({
      entity: { type: 'schedule', id }, expectedRevision: 1 }, { mutation: true })), 'remove earlier schedule')
    for (let index = 0; index < 2; index++) expectOk(await callQuietDesk(library, ['schedules', 'create'], request({
      id: crypto.randomUUID(), title: `时间 / Timed ${index}`, bodyMarkdown: '', kind,
      startAtUtc: zonedLocalToUtc(currentDate, 9, 0, appTimeZone), endAtUtc: zonedLocalToUtc(currentDate, 10, 0, appTimeZone)
    }, { mutation: true })), 'timed schedule')
  }
  for (const locale of ['zh-CN', 'en-US']) {
    expectOk(await callQuietDesk(library, ['settings', 'updateAppearance'], request({ locale }, { mutation: true })), 'appearance')
    await widget.waitForFunction(locale => document.documentElement.lang === locale, locale)
    await widget.getByTestId('widget-schedule-time').first().waitFor()
    await widget.waitForTimeout(250)
    const bounds = await widget.getByTestId('widget-schedule-time').first().evaluate(element => {
      const time = element.getBoundingClientRect(), list = element.closest('ul').getBoundingClientRect()
      return { text: element.textContent, top: time.top, bottom: time.bottom, listTop: list.top, listBottom: list.bottom }
    })
    await widget.screenshot({ path: resolve(evidence, `${kind}-${locale}.png`) })
    assert.ok(bounds.top >= bounds.listTop && bounds.bottom <= bounds.listBottom,
      `Core schedule time is clipped at 320x240: ${JSON.stringify(bounds)}`)
  }
  }
  console.info(`STAGE7_SMALL_TIME_PASS ${evidence}`)
} finally { await closeQuietDesk(runtime); await cleanIsolatedRoot(root, prefix) }
