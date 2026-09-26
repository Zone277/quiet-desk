import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { projectRoot } from './stage3-harness.mjs'

// A separate runner keeps Stage 2–5 harness semantics unchanged. No product hook.
export async function launchStage6(userData, { executablePath, extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
    QUIETDESK_TEST_USER_DATA: userData,
    QUIETDESK_TEST_NOW: '2026-09-26T04:00:00.000Z',
    QUIETDESK_TEST_TIME_ZONE: 'Asia/Shanghai',
    QUIETDESK_FORCE_FALLBACK: '1',
    QUIETDESK_SHOW_ALL_WINDOWS: '1'
  }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL',
    'QUIETDESK_STORAGE_SMOKE_MODE', 'QUIETDESK_AUTO_QUIT_MS',
    'QUIETDESK_TEST_OCCUPY_SHORTCUT', 'QUIETDESK_TEST_FAIL_NEXT_CAPTURE_SUBMIT']) delete env[key]
  if (executablePath) await access(executablePath)
  const app = await electron.launch({
    ...(executablePath ? { executablePath: resolve(executablePath) } : {}),
    args: executablePath ? ['--lang=zh-CN'] : ['--lang=zh-CN', projectRoot],
    cwd: userData, // Release must not resolve native resources from the source cwd.
    env,
    timeout: 30_000
  })
  const pages = new Map()
  try {
    const deadline = Date.now() + 30_000
    while (pages.size < 3 && Date.now() < deadline) {
      for (const page of app.windows()) {
        if (page.isClosed()) continue
        const kind = await page.locator('html').getAttribute('data-window-kind').catch(() => null)
        if (['widget', 'capture', 'library'].includes(kind)) pages.set(kind, page)
      }
      if (pages.size < 3) await new Promise((done) => setTimeout(done, 100))
    }
    assert.equal(pages.size, 3, 'all three real renderer entries must load')
    for (const page of pages.values()) {
      await page.locator('[data-testid="bootstrap-state"][data-state="ready"]').waitFor({ timeout: 15_000 })
    }
    const runtime = await app.evaluate(({ app }) => ({
      pid: process.pid,
      platform: process.platform,
      electron: process.versions.electron,
      node: process.versions.node,
      sqlite: process.versions.sqlite,
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    }))
    assert.equal(resolve(runtime.userData), resolve(userData), 'isolation must precede startup')
    assert.equal(runtime.packaged, Boolean(executablePath), 'wrong runtime provenance')
    return { app, pages, runtime }
  } catch (error) {
    await app.close().catch(() => undefined)
    throw error
  }
}

export async function quitStage6(runtime) {
  // Unlike the historical close helper, cleanup failures propagate to the owner.
  const process = runtime.app.process()
  const exited = runtime.app.waitForEvent('close', { timeout: 15_000 })
  await runtime.app.evaluate(({ app }) => { app.quit() }).catch((error) => {
    if (!/closed|destroyed|Target page/iu.test(String(error))) throw error
  })
  await exited
  assert.equal(process.exitCode, 0, 'app.quit must exit normally')
}
