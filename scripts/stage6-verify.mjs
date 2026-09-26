import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidence = resolve('test-results/stage6/commands')
await mkdir(evidence, { recursive: true })
const results = []
for (const script of ['check', 'test:integration', 'test:e2e', 'build', 'dist:win']) {
  const startedAt = new Date().toISOString()
  const child = spawn(process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script],
    { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    output += chunk.toString(); process.stdout.write(chunk)
  })
  const exitCode = await new Promise((done, reject) => {
    child.once('error', reject); child.once('close', done)
  })
  await writeFile(resolve(evidence, `${script.replaceAll(':', '-')}.log`), output, 'utf8')
  results.push({ command: `npm run ${script}`, startedAt, finishedAt: new Date().toISOString(), exitCode,
    status: exitCode === 0 ? 'PASS' : 'FAIL', hostNode: process.version, platform: process.platform })
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify(results, null, 2), 'utf8')
  if (exitCode !== 0) process.exitCode = 1
}
