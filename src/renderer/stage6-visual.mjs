// Run only in a Lead-assigned serial GUI slot, after Lead builds the current sources.
// $env:QUIETDESK_STAGE6_UI_SLOT='1'; node src/renderer/stage6-visual.mjs
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  projectRoot, ensureBuilt, makeIsolatedRoot, cleanIsolatedRoot,
  launchQuietDesk, closeQuietDesk, callQuietDesk, request, expectOk,
  bootstrap, shiftDateOnly, zonedLocalToUtc, assertCoreEntriesInViewport
} from '../../tests/e2e/stage3-harness.mjs'

assert.equal(process.env.QUIETDESK_STAGE6_UI_SLOT, '1', 'Lead must assign a serial GUI slot before running this harness')
const prefix = 'quietdesk-stage6-ui-'
const minimumOnly = process.argv.includes('--widget-minimum')
const previewOnly = process.argv.includes('--capture-preview')
const logsOnly = process.argv.includes('--daily-log-sections')
assert.ok(Number(minimumOnly) + Number(previewOnly) + Number(logsOnly) <= 1, 'Choose one targeted mode at a time')
const sizes = minimumOnly ? [[320, 240]] : previewOnly || logsOnly ? [[480, 420]] : [[320, 240], [480, 420], [720, 720], [437, 386]]
const locales = ['zh-CN', 'en-US']
const themes = ['light', 'dark', 'system']
const runId = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
const output = join(projectRoot, 'test-results', 'stage6-ui', runId)
const manifest = {
  runId, output, generator: 'src/renderer/stage6-visual.mjs',
  mode: minimumOnly ? 'widget-minimum' : previewOnly ? 'capture-preview' : logsOnly ? 'daily-log-sections' : 'baseline',
  generationStatus: 'NOT_RUN', visualInspectionStatus: 'NOT_RUN',
  note: 'Real Electron in explicit development fallback. This does not verify Windows desktop host behavior. Capture/Library minima are lowered only in this test process to stress their layouts.',
  runtime: null, screenshots: [], error: null
}
await ensureBuilt()
await mkdir(output, { recursive: true })
const root = await makeIsolatedRoot(prefix)
const persist = async () => writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
let runtime

async function snap(kind, locale, theme, size, state = 'top') {
  const page = runtime.pages.get(kind)
  const filename = `${kind}-${size[0]}x${size[1]}-${locale}-${theme}-${state}.png`
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    const content = document.querySelector('.window-content')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.documentElement.dataset.theme,
      locale: document.documentElement.lang,
      contentScroll: { width: content.scrollWidth, clientWidth: content.clientWidth, top: content.scrollTop },
      shellScroll: { width: shell.scrollWidth, clientWidth: shell.clientWidth }
    }
  })
  assert.equal(layout.locale, locale)
  assert.ok(layout.contentScroll.width <= layout.contentScroll.clientWidth + 1, `${filename}: content horizontal overflow ${JSON.stringify(layout)}`)
  assert.ok(layout.shellScroll.width <= layout.shellScroll.clientWidth + 1, `${filename}: header horizontal overflow`)
  const buffer = await page.screenshot({ path: join(output, filename), animations: 'disabled' })
  manifest.screenshots.push({ filename, kind, locale, theme, requestedSizeDip: size, state, layout,
    sha256: createHash('sha256').update(buffer).digest('hex'), inspectionStatus: 'NOT_RUN' })
  await persist()
}

try {
  runtime = await launchQuietDesk({ userData: root, locale: 'zh-CN' })
  manifest.runtime = { ...runtime.runtime, display: await runtime.app.evaluate(({ screen }) => screen.getPrimaryDisplay()) }
  const widget = runtime.pages.get('widget')
  const capture = runtime.pages.get('capture')
  const library = runtime.pages.get('library')
  const initial = await bootstrap(widget, 'widget')
  const mutate = async (page, path, payload) => expectOk(await callQuietDesk(page, path, request(payload, { mutation: true })), path.join('.'))
  for (let i = 0; i < 8; i++) {
    await mutate(capture, ['tasks', 'create'], {
      id: randomUUID(), title: `${i + 1}. 核对长文本 / Review long mixed-language text，中文标点与 emoji 📝`,
      bodyMarkdown: '昨日待办不自动改期。', planDate: shiftDateOnly(initial.currentDate, -1), dueDate: shiftDateOnly(initial.currentDate, -1)
    })
  }
  const done = await mutate(capture, ['tasks', 'create'], {
    id: randomUUID(), title: '已完成 / Completed', bodyMarkdown: '', planDate: null, dueDate: null
  })
  await mutate(widget, ['tasks', 'setCompletion'], { id: done.id, expectedRevision: done.revision, action: 'complete' })
  const markdown = '# 中英混排 / Mixed text 📝\n\n- [ ] 文档清单 / Document checklist\n\n| 项目 Item | 状态 Status |\n| --- | --- |\n| 长文字 Long text | 待核对 Review |\n\n```text\nLong_unbroken_line_abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\n```\n\n![远程图](https://example.com/blocked.png)'
  for (let i = 0; i < 3; i++) await mutate(capture, ['notes', 'create'], {
    id: randomUUID(), title: `笔记 / Note ${i + 1}`, bodyMarkdown: markdown
  })
  await mutate(capture, ['schedules', 'create'], {
    kind: 'timed', id: randomUUID(), title: '今日安排 / Today’s planned meeting', bodyMarkdown: '',
    startAtUtc: zonedLocalToUtc(initial.currentDate, 13, 0, initial.appTimeZone),
    endAtUtc: zonedLocalToUtc(initial.currentDate, 14, 0, initial.appTimeZone)
  })
  await mutate(capture, ['schedules', 'create'], {
    kind: 'all-day', id: randomUUID(), title: '全天计划 / All-day plan', bodyMarkdown: '',
    startDate: initial.currentDate, endDateExclusive: shiftDateOnly(initial.currentDate, 1)
  })
  const log = expectOk(await callQuietDesk(library, ['dailyLogs', 'get'], request({ date: initial.currentDate })), 'load log')
  await mutate(library, ['dailyLogs', 'saveManual'], { date: initial.currentDate, expectedRevision: log.manualRevision, manualMarkdown: '手写补充 / Manual addition 📝\n\n保留用户语言，不自动翻译。' })
  await capture.getByTestId('capture-title').fill('待保存的想法 / Draft idea')
  await capture.getByTestId('capture-body').fill(markdown)
  await capture.locator('[data-testid="draft-save-state"][data-state="saved"]').waitFor()
  await widget.getByTestId('current-task-item').first().waitFor()

  for (const locale of locales) for (const theme of themes) {
    await mutate(widget, ['settings', 'updateAppearance'], { locale, theme })
    for (const [kind, page] of runtime.pages) {
      if (minimumOnly && kind !== 'widget' || previewOnly && kind !== 'capture' || logsOnly && kind !== 'library') continue
      await page.waitForFunction(({ locale, theme }) => document.documentElement.lang === locale && document.documentElement.dataset.themePreference === theme, { locale, theme })
      for (const size of sizes) {
        const bounds = await runtime.app.evaluate(({ BrowserWindow }, { kind, size }) => {
          const win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes(`${kind}.html`))
          // Stress sizes for all three renderers; no production window constraints are changed.
          win.setMinimumSize(100, 100)
          win.setContentSize(size[0], size[1], false)
          return win.getContentSize()
        }, { kind, size })
        assert.ok(Math.abs(bounds[0] - size[0]) <= 1 && Math.abs(bounds[1] - size[1]) <= 1)
        await page.evaluate(() => { document.querySelector('.window-content').scrollTop = 0 })
        await page.waitForTimeout(120)
        if (kind === 'widget') {
          await assertCoreEntriesInViewport(page)
          const counts = await page.evaluate(() => {
            const section = document.querySelector('.tasks-section')
            return { shown: section.querySelectorAll('[data-testid="current-task-item"]').length, more: section.querySelector('.more-count')?.textContent }
          })
          assert.equal(counts.shown, size[1] <= 500 ? 1 : 3)
          assert.equal(counts.more, locale === 'zh-CN' ? `还有 ${8 - counts.shown} 项` : `${8 - counts.shown} more`)
          await page.getByTestId('host-mode').waitFor({ state: 'visible' })
          if (minimumOnly) {
            const visibility = await page.evaluate(() => {
              const visible = (element, parent) => {
                const rect = element.getBoundingClientRect()
                const boundary = parent.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0 && rect.top >= boundary.top - 1 && rect.bottom <= boundary.bottom + 1
              }
              return {
                titleHeight: document.querySelector('.window-header h1').getBoundingClientRect().height,
                rows: [...document.querySelectorAll('.widget-sections > section')].map((section) => ({
                  title: visible(section.querySelector('.item-copy strong'), section.querySelector('.item-list')),
                  count: visible(section.querySelector('.more-count'), section)
                }))
              }
            })
            assert.ok(visibility.titleHeight <= 22, `Widget title wrapped: ${JSON.stringify(visibility)}`)
            assert.ok(visibility.rows.every((row) => row.title && row.count), `Widget minimum clips item text/count: ${JSON.stringify(visibility)}`)
          }
        }
        if (!previewOnly && !logsOnly) await snap(kind, locale, theme, size)
        if (size[0] === 480 && kind === 'capture') {
          if (!previewOnly) {
            await page.getByTestId('capture-submit').scrollIntoViewIfNeeded()
            await snap(kind, locale, theme, size, 'footer')
          }
          await page.getByRole('button', { name: locale === 'zh-CN' ? '预览' : 'Preview', exact: true }).click()
          await page.locator('.capture-markdown-preview').scrollIntoViewIfNeeded()
          if (previewOnly) {
            const checkbox = await page.locator('.capture-markdown-preview input[type="checkbox"]').boundingBox()
            assert.ok(checkbox && checkbox.width <= 18 && checkbox.height <= 18, `Markdown checkbox inherited form field dimensions: ${JSON.stringify(checkbox)}`)
          }
          await snap(kind, locale, theme, size, 'preview')
          await page.getByRole('button', { name: locale === 'zh-CN' ? '源码' : 'Source', exact: true }).click()
        }
        if (size[0] === 480 && kind === 'library') {
          if (logsOnly) {
            for (const section of ['completed', 'pending-at-boundary', 'planned', 'notes']) {
              const target = page.getByTestId(`daily-log-${section}`)
              await target.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
              const visible = await target.locator('h4').evaluate((heading) => {
                const content = document.querySelector('.window-content').getBoundingClientRect()
                const rect = heading.getBoundingClientRect()
                return rect.top >= content.top - 1 && rect.bottom <= content.bottom + 1
              })
              assert.ok(visible, `${locale}/${theme}: ${section} heading is offscreen`)
              await snap(kind, locale, theme, size, section)
            }
          } else {
            await page.locator('.daily-log-heading').evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
            await snap(kind, locale, theme, size, 'daily-log')
            await page.getByTestId('daily-log-export').scrollIntoViewIfNeeded()
            await snap(kind, locale, theme, size, 'manual')
          }
        }
      }
    }
  }
  assert.equal(manifest.screenshots.length, logsOnly ? 24 : minimumOnly || previewOnly ? 6 : 96)
  manifest.generationStatus = 'PASS'
  await persist()
  console.info(`STAGE6_UI_GENERATION_PASS ${JSON.stringify({ output, screenshots: manifest.screenshots.length, visualInspectionStatus: 'NOT_RUN' })}`)
} catch (error) {
  manifest.generationStatus = 'FAIL'
  manifest.error = error instanceof Error ? error.stack : String(error)
  await persist()
  throw error
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(root, prefix)
}
