import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { HostBridge, apply, validate, ENDPOINT } from '../docker/plugins/dsh-instance-manager/index.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'requests'))
  await mkdir(join(root, 'results'))
  const status = { heartbeat: new Date().toISOString(), instance: { name: 'dsh' } }
  await writeFile(join(root, 'results/status.json'), JSON.stringify(status))
  return { root, bridge: new HostBridge(root), status }
}
const task = (action = 'restart', args = {}, id = randomUUID()) => ({ id, action, arguments: args })

test('unconfigured images still expose a working read-only setup state', async () => {
  const result = await new HostBridge(join(tmpdir(), randomUUID())).status()
  assert.deepEqual(result, { configured: false, online: false, status: null, jobs: [] })
})

test('jobs are atomically queued, immutable by retry, and carry no host command paths', async t => {
  const f = await fixture(t)
  const input = task('proxy-add', { name: 'hk-01', url: 'trojan://secret@example.com:443' })
  const result = await f.bridge.submit(input)
  assert.equal(result.state, 'queued')
  const original = await readFile(join(f.root, 'requests', input.id + '.json'), 'utf8')
  assert.deepEqual(JSON.parse(original).arguments, input.arguments)
  assert.equal((await f.bridge.submit({ ...input, action: 'restart', arguments: {} })).id, input.id)
  assert.equal(await readFile(join(f.root, 'requests', input.id + '.json'), 'utf8'), original)
  assert.deepEqual(await readdir(join(f.root, 'requests')), [input.id + '.json'])
  await assert.rejects(f.bridge.submit(task()), /instance-busy/)
})

test('active tasks block mutations; completed history survives bridge recreation', async t => {
  const f = await fixture(t)
  const id = randomUUID()
  await writeFile(join(f.root, 'results', id + '.json'), JSON.stringify({ id, action: 'update', state: 'running' }))
  await assert.rejects(f.bridge.submit(task('restart')), /instance-busy/)
  await writeFile(join(f.root, 'results', id + '.json'), JSON.stringify({ id, action: 'update', state: 'succeeded' }))
  const other = new HostBridge(f.root)
  assert.equal((await other.status()).jobs[0].state, 'succeeded')
  assert.equal((await other.submit(task('check'))).state, 'queued')
})

test('offline, corrupt, oversized and symlinked host data fail closed', async t => {
  const f = await fixture(t)
  for (const heartbeat of ['invalid', '2000-01-01T00:00:00Z', '2999-01-01T00:00:00Z']) {
    await writeFile(join(f.root, 'results/status.json'), JSON.stringify({ heartbeat }))
    await assert.rejects(f.bridge.submit(task()), /host-executor-offline/)
  }
  await writeFile(join(f.root, 'results/status.json'), 'x'.repeat(270000))
  await assert.rejects(f.bridge.status(), /unsafe-management-file/)
  if (process.platform !== 'win32') {
    await rm(join(f.root, 'results/status.json'))
    await writeFile(join(f.root, 'secret'), '{"secret":"never return this"}')
    await symlink(join(f.root, 'secret'), join(f.root, 'results/status.json'))
    await assert.rejects(f.bridge.status(), /ELOOP/)
  }
})

test('only named operations and bounded proxy inputs are accepted', () => {
  for (const [action, args] of [
    ['shell', { command: 'rm -rf /' }], ['restart', { container: 'other' }],
    ['proxy-use', { name: '../../other' }], ['proxy-subscribe', { name: 'x', url: 'file:///etc/shadow' }],
    ['proxy-add', { name: 'x', url: 'https://example.com\nwhoami' }],
    ['settings', { checkInterval: true }], ['settings', { checkInterval: 1 }],
  ]) assert.throws(() => validate(action, args))
  validate('proxy-add', { name: 'hk-01', url: 'ss://abc@example.com:443' })
  validate('settings', { checkInterval: 3600 })
})

test('authenticated hook passes unrelated requests and requires same-origin JSON writes', async t => {
  const f = await fixture(t)
  const previous = process.env.DSH_MANAGEMENT_BRIDGE
  process.env.DSH_MANAGEMENT_BRIDGE = f.root
  t.after(() => { if (previous === undefined) delete process.env.DSH_MANAGEMENT_BRIDGE; else process.env.DSH_MANAGEMENT_BRIDGE = previous })
  let handler
  apply({ on(event, fn) { assert.equal(event, 'connection/request'); handler = fn } })
  async function request(method, headers = {}, value, url = ENDPOINT) {
    const req = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))])
    Object.assign(req, { method, headers, url })
    let result
    const res = { writeHead(status) { this.status = status }, end(body) { this.writableEnded = true; result = { status: this.status, body: JSON.parse(body) } } }
    await handler(req, res, () => { result = 'next' })
    return result
  }
  assert.equal(await request('GET', {}, undefined, '/api/sessions'), 'next')
  assert.equal((await request('GET')).body.online, true)
  assert.equal((await request('POST', {}, task())).status, 403)
  const headers = { 'content-type': 'application/json', 'x-dsh-management': '1' }
  assert.equal((await request('POST', { ...headers, 'sec-fetch-site': 'cross-site' }, task())).status, 403)
  assert.equal((await request('POST', headers, task('shell'))).status, 400)
  assert.equal((await request('POST', headers, task('check'))).status, 202)
})
