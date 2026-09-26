import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path) => readFile(join(root, path), 'utf8')

test('QA matrix preserves all 28 acceptance IDs exactly once', async () => {
  const report = await read('docs/reviews/stage6-qa.md')
  const ids = [...report.matchAll(/^\| (A\d{2}) \|/gmu)].map((match) => match[1])
  assert.deepEqual(ids, Array.from({ length: 28 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`))
  assert.equal(new Set(ids).size, 28)
})

test('renderer entry CSP restricts scripts and images; local module entry exists', async () => {
  for (const kind of ['widget', 'capture', 'library']) {
    const html = await read(`src/renderer/${kind}.html`)
    assert.match(html, /Content-Security-Policy/u)
    assert.match(html, /default-src 'self'/u)
    assert.match(html, /script-src 'self'(?:;|")/u)
    assert.match(html, /img-src 'self' data:/u)
    assert.doesNotMatch(html, /(?:https?:|\*)[^"<]*script-src|script-src[^;"<]*'unsafe-eval'/u)
    assert.match(html, /<script type="module" src="(?:\/src\/|\.\/src\/).*\.tsx"><\/script>/u)
  }
})

test('renderer source contains no direct Electron/SQL/shell imports or raw HTML renderer', async () => {
  async function walk(directory) {
    const files = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) files.push(...await walk(path))
      else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) files.push(path)
    }
    return files
  }
  for (const path of await walk(join(root, 'src/renderer/src'))) {
    const source = await readFile(path, 'utf8')
    assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:electron|node:|better-sqlite3)/u, path)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|rehype-raw/u, path)
  }
})

test('packaging excludes source test databases; runtime dependencies are explicitly locked', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const lock = JSON.parse(await read('package-lock.json'))
  assert.equal(manifest.main, './out/main/index.js')
  assert.ok(manifest.build.files.includes('out/**/*'))
  for (const pattern of manifest.build.files) {
    assert.doesNotMatch(pattern, /^(?:\*\*\/\*|tests|test-results|docs|data|\.env)/u)
  }
  assert.equal(lock.packages[''].version, manifest.version)
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies)
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/u, `${name}: runtime version is floating`)
    assert.equal(lock.packages[`node_modules/${name}`].version, version)
  }
  for (const script of ['dev', 'check', 'test:integration', 'test:e2e', 'build', 'dist:win']) {
    assert.ok(manifest.scripts[script], `${script} missing`)
    assert.doesNotMatch(manifest.scripts[script], /echo\s+.*(?:pass|success)|exit\s+0/iu)
  }
})
