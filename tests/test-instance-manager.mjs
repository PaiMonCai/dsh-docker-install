import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { HostBridge, apply, validate, ENDPOINT, LOGS_ENDPOINT, serveLogStream } from '../docker/plugins/dsh-instance-manager/index.js'

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

test('host capability metadata prevents submitting unsupported or unknown-version operations', async t => {
  const f = await fixture(t)
  const statusFile = join(f.root, 'results', 'status.json')
  await writeFile(statusFile, JSON.stringify({ ...f.status,
    management: { schema: 1, operations: ['check'] } }))
  await assert.rejects(f.bridge.submit(task('restart')), /host-operation-unavailable/)
  assert.deepEqual(await readdir(join(f.root, 'requests')), [])
  assert.equal((await f.bridge.submit(task('check'))).state, 'queued')
  await rm(join(f.root, 'requests'), { recursive: true })
  await mkdir(join(f.root, 'requests'))
  await writeFile(statusFile, JSON.stringify({ ...f.status,
    management: { schema: 2, operations: ['restart', 'check'] } }))
  await assert.rejects(f.bridge.submit(task('restart')), /host-operation-unavailable/)
})

test('legacy hosts reject new phase-two requests while retaining old restart behavior', async t => {
  const f = await fixture(t)
  await assert.rejects(f.bridge.submit(task('edition-standard')), /host-operation-unavailable/)
  await assert.deepEqual(await readdir(join(f.root, 'requests')), [])
  assert.equal((await f.bridge.submit(task('restart'))).state, 'queued')
})

test('phase-two administrative actions are strictly fixed and do not accept paths or images', () => {
  for (const action of [
    'edition-standard', 'edition-research', 'pack-none', 'pack-economics',
    'dashboard-start', 'dashboard-stop', 'diagnose-environment',
    'diagnose-storage', 'diagnose-plugins'
  ]) {
    assert.doesNotThrow(() => validate(action, {}), action)
    for (const parameters of [{ image: 'evil:latest' }, { instanceId: 'other' }, { command: 'id' }])
      assert.throws(() => validate(action, parameters), action)
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

test('SSE logs emit an initial bounded snapshot then new lines without replay duplicates', async t => {
  const f = await fixture(t)
  const generation = randomUUID()
  const file = join(f.root, 'results', 'log-stream.json')
  const output = []
  function response() {
    const res = new EventEmitter()
    res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
    res.write = chunk => { output.push(chunk); return true }
    res.end = () => { res.writableEnded = true; res.emit('close') }
    return res
  }
  const req = new EventEmitter()
  req.headers = {}
  const save = async (seq, entries) => writeFile(file, JSON.stringify({
    generation, seq, entries, updatedAt: new Date().toISOString(),
  }))
  await save(2, [{ seq: 1, text: 'INFO started' }, { seq: 2, text: 'WARN retrying' }])
  const res = response()
  await serveLogStream(req, res, f.bridge)
  t.after(() => res.emit('close'))
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/event-stream/)
  assert.equal(res.headers['x-accel-buffering'], 'no')
  assert.match(output.join(''), /event: logs/)
  assert.match(output.join(''), /"mode":"snapshot"/)
  assert.match(output.join(''), /INFO started/)
  await save(3, [{ seq: 1, text: 'INFO started' }, { seq: 2, text: 'WARN retrying' },
    { seq: 3, text: 'ERROR network down' }])
  await new Promise(resolve => setTimeout(resolve, 425))
  const frames = output.filter(value => value.includes('event: logs'))
  assert.equal(frames.length, 2)
  assert.match(frames[1], /"mode":"append"/)
  assert.match(frames[1], /ERROR network down/)
  assert.doesNotMatch(frames[1], /INFO started/)
  res.emit('close')
  assert.equal(res.writableEnded, true)
})

test('SSE replay after reconnection sends missed entries, not a duplicate snapshot', async t => {
  const f = await fixture(t)
  const generation = randomUUID()
  const entries = [{ seq: 1, text: 'one' }, { seq: 2, text: 'two' }, { seq: 3, text: 'three' }]
  await writeFile(join(f.root, 'results', 'log-stream.json'), JSON.stringify({
    generation, seq: 3, entries, updatedAt: new Date().toISOString(),
  }))
  const req = new EventEmitter()
  req.headers = { 'last-event-id': generation + ':2' }
  const chunks = []
  const res = new EventEmitter()
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.write = chunk => { chunks.push(chunk); return true }
  res.end = () => { res.writableEnded = true; res.emit('close') }
  await serveLogStream(req, res, f.bridge)
  t.after(() => res.emit('close'))
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.match(chunks.join(''), /"mode":"append"/)
  assert.match(chunks.join(''), /three/)
  assert.doesNotMatch(chunks.join(''), /"lines":\["one"/)
})

test('SSE log stream rejects symlinked host files and does not execute any jobs', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'safe.json')
  await writeFile(target, '{}')
  await symlink(target, join(f.root, 'results', 'log-stream.json'))
  await assert.rejects(f.bridge.logStream(), /ELOOP/)
  assert.deepEqual(await readdir(join(f.root, 'requests')), [])
  assert.equal(LOGS_ENDPOINT, ENDPOINT + '/logs')
})
