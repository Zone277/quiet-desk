import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const prefix = 'QUIETDESK_STORAGE_SMOKE '

function runElectron(mode, userData) {
  return new Promise((resolvePromise, rejectPromise) => {
    const environment = {
      ...process.env,
      QUIETDESK_TEST_USER_DATA: userData,
      QUIETDESK_STORAGE_SMOKE_MODE: mode
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.ELECTRON_RENDERER_URL

    const child = spawn(electronPath, [projectRoot], {
      cwd: projectRoot,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    const timeout = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        })
      } else {
        child.kill('SIGKILL')
      }
    }, 20_000)

    child.once('error', rejectPromise)
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) {
        rejectPromise(new Error(`Electron ${mode} failed (code=${code}, signal=${signal})\n${stderr}\n${stdout}`))
        return
      }
      const line = stdout.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix))
      if (!line) {
        rejectPromise(new Error(`Electron ${mode} emitted no storage evidence\n${stderr}\n${stdout}`))
        return
      }
      resolvePromise(JSON.parse(line.slice(prefix.length)))
    })
  })
}

const testRoot = await mkdtemp(join(tmpdir(), 'quietdesk-integration-'))
try {
  const first = await runElectron('write-reopen', testRoot)
  assert.equal(first.electron, '44.4.3')
  assert.match(first.node, /^24\./u)
  assert.ok(first.sqlite, 'Electron must report its linked SQLite version')
  assert.equal(first.created.replayed, false)
  assert.equal(first.replayed.replayed, true)
  assert.deepEqual(first.reopened, first.created.note)
  assert.equal(first.revision, 1)
  assert.match(first.reopened.bodyMarkdown, /中英文 persistence/u)

  const second = await runElectron('read-after-restart', testRoot)
  assert.equal(second.electron, first.electron)
  assert.deepEqual(second.note, first.reopened)
  assert.equal(second.revision, 1)

  const databasePath = join(testRoot, 'data', 'quietdesk.sqlite3')
  assert.equal((await stat(databasePath)).isFile(), true)
  assert.equal(relative(testRoot, databasePath).startsWith('..'), false)
  console.info(`INTEGRATION_S2_ELECTRON_SQLITE_PASS ${JSON.stringify({
    electron: first.electron,
    node: first.node,
    sqlite: first.sqlite,
    databasePath,
    revision: second.revision,
    noteId: second.note.id
  })}`)
} finally {
  const resolvedRoot = resolve(testRoot)
  const expectedPrefix = resolve(tmpdir(), 'quietdesk-integration-')
  if (!resolvedRoot.startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolvedRoot}`)
  }
  await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
