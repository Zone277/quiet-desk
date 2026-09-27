import assert from 'node:assert/strict'
import { bootstrap, callQuietDesk, cleanIsolatedRoot, expectOk, launchQuietDesk,
  makeIsolatedRoot, request } from './stage3-harness.mjs'
import { quitStage6 } from './stage6-runtime.mjs'
const prefix = 'quietdesk-stage7-json-electron-'
const root = await makeIsolatedRoot(prefix)
let runtime
try {
  runtime = await launchQuietDesk({ userData: root })
  const capture = runtime.pages.get('capture'), library = runtime.pages.get('library')
  await bootstrap(library, 'library')
  const draftId = '10000000-0000-4000-8000-000000000001', entityId = crypto.randomUUID()
  const bodyMarkdown = '\u0001'.repeat(1_000_000)
  const draft = expectOk(await callQuietDesk(capture, ['drafts', 'save'], request({
    id: draftId, expectedRevision: 0, captureKind: 'note', payload: { kind: 'note', title: 'Electron JSON 六倍边界', bodyMarkdown }
  }, { mutation: true })), 'full draft')
  const submitted = expectOk(await callQuietDesk(capture, ['drafts', 'submit'], request({
    draftId, expectedRevision: draft.revision, entityId
  }, { mutation: true })), 'full draft transaction')
  assert.equal(submitted.entity.value.bodyMarkdown, bodyMarkdown)
  const history = expectOk(await callQuietDesk(library, ['library', 'getHistory'], request({ type: 'note', id: entityId })), 'full snapshot')
  assert.ok(history.some(operation => operation.snapshot.value.bodyMarkdown === bodyMarkdown))
  const pid = runtime.runtime.pid
  await quitStage6(runtime)
  runtime = await launchQuietDesk({ userData: root })
  assert.notEqual(runtime.runtime.pid, pid)
  const note = expectOk(await callQuietDesk(runtime.pages.get('library'), ['notes', 'get'], request({ id: entityId })), 'full note restart')
  assert.equal(note.bodyMarkdown, bodyMarkdown)
  console.info(`STAGE7_ELECTRON_JSON_LIMITS_PASS ${JSON.stringify({ electron: runtime.runtime.electron, sqlite: runtime.runtime.sqlite, characters: bodyMarkdown.length })}`)
} finally {
  if (runtime) await quitStage6(runtime)
  await cleanIsolatedRoot(root, prefix)
}
