import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import {
  assertCoreEntriesInViewport,
  bootstrap,
  callQuietDesk,
  cleanIsolatedRoot,
  closeQuietDesk,
  ensureBuilt,
  expectOk,
  launchQuietDesk,
  makeIsolatedRoot,
  projectRoot,
  request,
  requiredCapabilities,
  setWidgetContentSize,
  shiftDateOnly,
  zonedLocalToUtc
} from './stage3-harness.mjs'

const DATA_ROOT_PREFIX = 'quietdesk-stage3-visual-data-'
const sizes = [[320, 240], [480, 420], [720, 720], [437, 386]]
const themes = ['light', 'dark', 'system']
const locales = ['zh-CN', 'en-US']

function pngDimensions(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  assert.equal(signature, '89504e470d0a1a0a', 'Screenshot is not a PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function writeManifest(path, manifest) {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function requireVisualCapabilities(runtime) {
  const snapshot = await bootstrap(runtime.pages.get('widget'), 'widget')
  assert.equal(snapshot.contractVersion, 4)
  assert.equal(snapshot.stage, 5)
  const required = [
    ...requiredCapabilities.filter((capability) => [
      'widget.getSnapshot',
      'tasks.create',
      'tasks.setCompletion',
      'notes.create',
      'schedules.create',
      'settings.updateAppearance',
      'changes.subscribe'
    ].includes(capability))
  ]
  const missing = required.filter((capability) => !snapshot.implementedCapabilities.includes(capability))
  assert.deepEqual(missing, [], `Visual setup handlers are not integrated: ${missing.join(', ')}`)
  return snapshot
}

async function seedBaseline(capture, currentDate, timeZone) {
  const taskSpecs = [
    ['视觉检查：整理阶段三证据', 'Visual QA / 中文正文 🌿'],
    ['Review mixed English and 中文 typography', 'ArchitectureReviewWithoutConvenientBreakPoints'],
    ['确认最近笔记入口与日期浏览', 'https://example.invalid/very/long/path'],
    ['今日已完成：保存截图 manifest', 'completed item one'],
    ['今日已完成：记录 resolved theme', 'completed item two']
  ]
  const tasks = []
  for (let index = 0; index < taskSpecs.length; index += 1) {
    const [title, bodyMarkdown] = taskSpecs[index]
    const task = expectOk(
      await callQuietDesk(capture, ['tasks', 'create'], request({
        id: randomUUID(),
        title,
        bodyMarkdown,
        planDate: currentDate,
        dueDate: index === 1 ? shiftDateOnly(currentDate, 1) : null
      }, { mutation: true })),
      `visual task ${index + 1}`
    )
    tasks.push(task)
  }

  for (const task of tasks.slice(-2)) {
    expectOk(
      await callQuietDesk(capture, ['tasks', 'setCompletion'], request({
        id: task.id,
        expectedRevision: task.revision,
        action: 'complete'
      }, { mutation: true })),
      `complete visual task ${task.id}`
    )
  }

  for (const [title, bodyMarkdown] of [
    ['Quiet note / 安静记录', '中英文 mixed preview，emoji 🌙'],
    ['长记录标题 ArchitectureReviewWithoutConvenientBreakPoints', '# Markdown\n\n- [ ] 文档清单不是任务']
  ]) {
    expectOk(
      await callQuietDesk(capture, ['notes', 'create'], request({
        id: randomUUID(),
        title,
        bodyMarkdown
      }, { mutation: true })),
      `visual note ${title}`
    )
  }

  expectOk(
    await callQuietDesk(capture, ['schedules', 'create'], request({
      kind: 'timed',
      id: randomUUID(),
      title: '今日安排 / Today 13:00–14:00',
      bodyMarkdown: '计划，不代表已经参加。',
      startAtUtc: zonedLocalToUtc(currentDate, 13, 0, timeZone),
      endAtUtc: zonedLocalToUtc(currentDate, 14, 0, timeZone)
    }, { mutation: true })),
    'visual schedule'
  )
}

await ensureBuilt()
const dataRoot = await makeIsolatedRoot(DATA_ROOT_PREFIX)
const runId = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`
const outputDirectory = join(projectRoot, 'test-results', 'stage3', runId)
const manifestPath = join(outputDirectory, 'manifest.json')
await mkdir(outputDirectory, { recursive: true })

const manifest = {
  schemaVersion: 1,
  runId,
  generatedAtUtc: new Date().toISOString(),
  generator: 'tests/e2e/stage3-visual.mjs',
  contractVersion: 4,
  generationStatus: 'RUNNING',
  visualInspectionStatus: 'NOT_RUN',
  visualInspectionNote: 'Screenshots were generated only. Lead must open and inspect every image before visual PASS.',
  isolatedUserData: dataRoot,
  outputDirectory: relative(projectRoot, outputDirectory),
  matrix: {
    sizes: sizes.map(([width, height]) => ({ width, height })),
    themes,
    locales,
    expectedScreenshotCount: 24
  },
  runtime: null,
  screenshots: [],
  error: null
}
await writeManifest(manifestPath, manifest)

let runtime
try {
  runtime = await launchQuietDesk({ userData: dataRoot, locale: 'zh-CN' })
  manifest.runtime = { ...runtime.runtime, display: null, appTimeZone: null }
  await writeManifest(manifestPath, manifest)
  const initial = await requireVisualCapabilities(runtime)
  const display = await runtime.app.evaluate(({ screen }) => {
    const primary = screen.getPrimaryDisplay()
    return {
      id: String(primary.id),
      scaleFactor: primary.scaleFactor,
      bounds: primary.bounds,
      workArea: primary.workArea
    }
  })
  manifest.runtime = { ...runtime.runtime, display, appTimeZone: initial.appTimeZone }

  await seedBaseline(runtime.pages.get('capture'), initial.currentDate, initial.appTimeZone)
  const widget = runtime.pages.get('widget')

  for (const locale of locales) {
    for (const theme of themes) {
      const appearance = expectOk(
        await callQuietDesk(widget, ['settings', 'updateAppearance'], request({ locale, theme }, { mutation: true })),
        `appearance ${locale}/${theme}`
      )
      assert.deepEqual(appearance, { locale, theme })

      const current = await bootstrap(widget, 'widget')
      assert.equal(current.locale, locale)
      assert.equal(current.theme, theme)

      await widget.waitForFunction(
        ({ locale: expectedLocale, theme: expectedTheme, resolvedTheme }) => {
          const root = document.documentElement
          return root.lang === expectedLocale &&
            root.dataset.themePreference === expectedTheme &&
            root.dataset.theme === resolvedTheme
        },
        { locale, theme, resolvedTheme: current.resolvedTheme },
        { timeout: 15_000 }
      )

      for (const [width, height] of sizes) {
        const bounds = await setWidgetContentSize(runtime.app, width, height)
        await widget.waitForTimeout(100)
        const layout = await assertCoreEntriesInViewport(widget)
        const filename = `widget-${width}x${height}-${locale}-${theme}.png`
        const absolutePath = join(outputDirectory, filename)
        const buffer = await widget.screenshot({ path: absolutePath, animations: 'disabled' })
        const image = pngDimensions(buffer)
        const sha256 = createHash('sha256').update(buffer).digest('hex')

        manifest.screenshots.push({
          file: basename(absolutePath),
          window: 'widget',
          requestedContentSizeDip: { width, height },
          actualContentBoundsDip: bounds.contentBounds,
          outerBoundsDip: bounds.bounds,
          viewportCss: layout.viewport,
          imagePixels: image,
          locale,
          theme,
          resolvedTheme: current.resolvedTheme,
          dataRevision: current.dataRevision,
          sha256,
          inspectionStatus: 'NOT_RUN',
          inspectionNotes: null
        })
        await writeManifest(manifestPath, manifest)
      }
    }
  }

  assert.equal(manifest.screenshots.length, 24)
  assert.equal(new Set(manifest.screenshots.map((entry) => entry.file)).size, 24)
  manifest.generationStatus = 'PASS'
  await writeManifest(manifestPath, manifest)
  console.info(`STAGE3_VISUAL_GENERATION_PASS ${JSON.stringify({
    outputDirectory,
    manifestPath,
    screenshots: manifest.screenshots.length,
    visualInspectionStatus: manifest.visualInspectionStatus
  })}`)
} catch (error) {
  manifest.generationStatus = 'FAIL'
  manifest.error = error instanceof Error ? error.message : String(error)
  await writeManifest(manifestPath, manifest)
  console.error(`STAGE3_VISUAL_GENERATION_FAIL ${JSON.stringify({
    outputDirectory,
    manifestPath,
    screenshots: manifest.screenshots.length,
    visualInspectionStatus: manifest.visualInspectionStatus,
    message: manifest.error
  })}`)
  throw error
} finally {
  await closeQuietDesk(runtime)
  await cleanIsolatedRoot(dataRoot, DATA_ROOT_PREFIX)
}
