import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply, ENDPOINT } from '../docker/plugins/dsh-session-manager-web/index.js'

const home = await mkdtemp(join(tmpdir(), 'dsh-web-trash-'))
const oldHome = process.env.DSH_HOME
const oldRestart = process.env.DSH_DOCKER_RESTART
process.env.DSH_HOME = home
process.env.DSH_DOCKER_RESTART = 'container'

const project = '--workspace--'
const id = 'session-aabbccdd'
const other = 'session-11223344'
const directory = id => join(home, 'sessions', project, id)
async function create(id) {
  await mkdir(directory(id), { recursive: true })
  await writeFile(join(directory(id), 'session.v4.jsonl'), '{"type":"header"}\n')
}
const inUse = new Set()
let active = false
let stopRequests = 0
let openAttempts = 0
let handler, nextCount = 0
const archived = new Set()
const removed = []
const ctx = {
  sessionPersistence: {
    async stat(sessionId) {
      const dir = await readdir(join(home, 'sessions', project)).catch(() => [])
      return dir.includes(sessionId) ? { header: { id: sessionId } } : undefined
    },
    async open() {
      openAttempts++
      throw new Error('SessionAlreadyOwnedError: owner still active')
    },
  },
  workspaceRegistry: {
    archivedSessionIds: archived,
    async archiveSession(id, options = {}) {
      assert.equal(options.stopActivity, true)
      archived.add(id)
    },
    async unarchiveSession(id) { archived.delete(id) },
  },
  sessions: { get(id) { return inUse.has(id) ? { id } : undefined } },
  agents: { get() { return active ? { status: 'running' } : undefined } },
  async parallel(event, { sessionId }) {
    assert.equal(event, 'workspace/session-stop')
    assert.ok(sessionId)
    stopRequests++
    active = false
  },
  on(name, fn) { assert.equal(name, 'connection/request'); handler = fn },
  emit(name, id) { if (name === 'api-session/removed') removed.push(id) },
  logger: { warn() {} },
}
function request(method, value, opts = {}) {
  const raw = opts.raw ?? JSON.stringify(value ?? {})
  const req = Readable.from([Buffer.from(raw)])
  req.url = opts.path ?? ENDPOINT
  req.method = method
  req.headers = { 'content-type': 'application/json' }
  let code = 0, text = ''
  const res = {
    writableEnded: false,
    writeHead(status) { code = status },
    end(s = '') { text += s; this.writableEnded = true },
  }
  return handler(req, res, async () => { nextCount++ }).then(() => ({
    code, data: text ? JSON.parse(text) : null,
  }))
}

try {
  const client = await readFile(new URL('../docker/plugins/dsh-session-manager-web/client.js', import.meta.url), 'utf8')
  assert.match(client, /trash: '删除会话'/)
  assert.doesNotMatch(client, /dangerTitle|typeToConfirm|confirmPurge|type: 'confirm'/)
  assert.doesNotMatch(client, /PermanentMenu|dsh-docker\.permanent/)
  assert.doesNotMatch(client, /navigator\.language|document\.documentElement\.lang/)
  assert.match(client, /act\('purge', selectedIds\)/)

  apply(ctx)
  await create(id)
  await create(other)
  assert.equal((await request('GET', {}, { path: '/api/other' })).code, 0)
  assert.equal(nextCount, 1)
  assert.equal((await request('DELETE', {})).code, 405)
  assert.equal((await request('POST', { action: 'trash', sessionId: '../etc' })).code, 400)
  assert.equal((await request('POST', {}, { raw: '{' })).code, 400)
  assert.equal((await request('POST', { action: 'trash', sessionId: 'session-nope' })).code, 404)

  const submitted = await request('POST', { action: 'trash', sessionId: id, title: 'Test session' })
  assert.equal(submitted.code, 200)
  assert.deepEqual(submitted.data, { trashed: true })
  assert.equal(archived.has(id), true)
  assert.equal((await readdir(directory(id))).includes('session.v4.jsonl'), true)
  assert.equal((await request('POST', { action: 'trash', sessionId: id })).data.existing, true)
  let list = await request('GET')
  assert.equal(list.code, 200)
  assert.equal(list.data.items.length, 1)
  assert.equal(list.data.items[0].title, 'Test session')
  assert.match(await readFile(join(home, '.dshd-session-trash-v2', id + '.json'), 'utf8'), /Test session/)
  assert.equal((await request('POST', { action: 'restore', sessionId: id })).code, 200)
  assert.equal(archived.has(id), false)
  assert.deepEqual((await request('GET')).data.items, [])

  // Permanent deletion from the main list is impossible, even with a
  // hand-crafted POST that bypasses the browser menu.
  assert.equal((await request('POST', { action: 'permanent', sessionId: id })).code, 409)
  assert.equal((await request('POST', { action: 'purge', sessionId: id })).code, 409)
  assert.equal((await readdir(directory(id))).includes('session.v4.jsonl'), true)

  // A running session is allowed into trash. Its work receives native stop.
  active = true
  inUse.add(id)
  assert.equal((await request('POST', { action: 'trash', sessionId: id })).code, 200)
  assert.equal(archived.has(id), true)
  // Pretend the Host still keeps a stale Agent and exclusive writer, as on
  // actual long-running Web processes. Force purge must not open the lease.
  active = true
  assert.equal((await request('POST', { action: 'purge', sessionId: id })).code, 200)
  assert.equal(removed.includes(id), true)
  assert.ok(stopRequests >= 1)
  assert.equal(openAttempts, 0)
  assert.deepEqual(await readdir(join(home, 'sessions', project)), [other])
  assert.equal(archived.has(id), true, 'retain archived tombstone for cached live sessions')
  assert.equal((await request('POST', { action: 'restore', sessionId: id })).code, 404)
  assert.deepEqual((await request('GET')).data.items, [])

  // A second session follows the same two-stage workflow.
  assert.equal((await request('POST', { action: 'purge', sessionId: other })).code, 409)
  await request('POST', { action: 'trash', sessionId: other })
  assert.equal((await request('POST', { action: 'purge', sessionId: other })).code, 200)
  assert.deepEqual((await request('GET')).data.items, [])
  assert.equal(archived.has(other), true)
  assert.equal(openAttempts, 0)
  assert.equal((await request('POST', { action: 'purge', sessionId: other })).code, 409)

  const unsafe = 'session-abcdef01'
  await symlink(home, directory(unsafe), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await request('POST', { action: 'trash', sessionId: unsafe })).code, 404)
  assert.equal(process.env.DSH_DOCKER_RESTART, 'container')
  console.log('Web session two-stage trash / forced purge / no Docker restart checks passed')
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldRestart === undefined) delete process.env.DSH_DOCKER_RESTART
  else process.env.DSH_DOCKER_RESTART = oldRestart
  await rm(home, { recursive: true, force: true })
}
