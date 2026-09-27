import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidence = resolve('test-results/stage7', `commands-${Date.now()}`)
await mkdir(evidence, { recursive: true })
const results = []
const commands = process.argv.includes('--supplement') ? [
  'node tests/e2e/stage7-quit-freeze.mjs',
  'node tests/e2e/stage7-small-time.mjs',
  'node tests/e2e/stage7-json-limits.mjs',
  'node tests/e2e/stage7-demo.mjs',
  'node tests/e2e/stage7-editor.mjs',
  'node src/renderer/stage6-visual.mjs --widget-minimum',
  'node src/renderer/stage6-visual.mjs --capture-preview'
] : [
  'npm run check',
  'npm run build',
  'npx vitest run tests/data tests/platform',
  'npx vitest run --config src/renderer/vitest.config.ts',
  'npm run test:integration',
  'npm run test:e2e',
  'node tests/e2e/stage7-demo.mjs',
  'node tests/e2e/stage7-runtime-refresh.mjs',
  'node tests/e2e/stage7-editor.mjs',
  'node tests/e2e/stage7-quit-draft.mjs',
  'node tests/e2e/stage7-quit-library.mjs',
  'node tests/e2e/stage7-quit-freeze.mjs',
  'node tests/e2e/stage7-small-time.mjs',
  'node tests/e2e/stage7-reading-race.mjs order',
  'node tests/e2e/stage7-reading-race.mjs delete',
  'node tests/e2e/stage7-reading-race.mjs capture',
  'npm run build',
  'npm run dist:win',
  `node tests/e2e/stage6-release.mjs "${resolve('release/win-unpacked/QuietDesk.exe')}"`,
  `node scripts/stage6-release-smoke.mjs "${resolve('test-results/stage7', `发布 验证 ${Date.now()}`)}"`,
  `node scripts/stage6-portable-smoke.mjs "${resolve('test-results/stage7', `便携 启动 ${Date.now()}`)}"`,
  'node --test tests/platform/stage6-release-audit.test.mjs'
]
for (const [index, command] of commands.entries()) {
  const startedAt = new Date().toISOString()
  const parts = command.match(/"[^"]*"|\S+/gu).map(part => part.replace(/^"|"$/gu, ''))
  // Direct Node argv preserves Chinese/spaced paths without cmd/CRT double quoting.
  const child = spawn(parts[0] === 'node' ? process.execPath : 'cmd.exe',
    parts[0] === 'node' ? parts.slice(1) : ['/d', '/s', '/c', command], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(command.includes('stage6-visual.mjs') ? { QUIETDESK_STAGE6_UI_SLOT: '1' } : {}) }
  })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    output += chunk.toString(); process.stdout.write(chunk)
  })
  const exitCode = await new Promise((done, reject) => {
    child.once('error', reject); child.once('close', done)
  })
  const log = `${String(index + 1).padStart(2, '0')}.log`
  await writeFile(resolve(evidence, log), output, 'utf8')
  results.push({ command, startedAt, finishedAt: new Date().toISOString(), exitCode,
    status: exitCode === 0 ? 'PASS' : 'FAIL', hostNode: process.version,
    platform: process.platform, log })
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify(results, null, 2), 'utf8')
  if (exitCode !== 0) process.exitCode = 1
}
console.info(`STAGE7_COMMAND_EVIDENCE ${evidence}`)
