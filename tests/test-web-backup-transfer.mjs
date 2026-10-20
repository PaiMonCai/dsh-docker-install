import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply } from '../docker/plugins/dsh-instance-manager/index.js'

test('authenticated backup binary routes stream and reject unsafe requests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-backup-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  for (const sub of ['requests', 'results', 'uploads', 'backups']) await mkdir(join(root, sub))
  const previous = process.env.DSH_MANAGEMENT_BRIDGE
  process.env.DSH_MANAGEMENT_BRIDGE = root
  t.after(() => { if (previous === undefined) delete process.env.DSH_MANAGEMENT_BRIDGE
    else process.env.DSH_MANAGEMENT_BRIDGE = previous })
  let handler
  apply({ on(event, callback) {
    assert.equal(event, 'connection/request')
    handler = callback
  }, logger: { warn() {} } })
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res, () => { res.writeHead(404); res.end() }))
      .catch(() => { if (!res.headersSent) { res.writeHead(500); res.end() } })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = 'http://127.0.0.1:' + server.address().port
  const endpoint = '/api/dsh-docker-instance-manager'
  const file = 'dsh-full-20261020-120000.dshbak'
  const content = Buffer.from('portable-test-secret-payload')
  await writeFile(join(root, 'backups', file), content, { mode: 0o600 })
  const headers = { 'sec-fetch-site': 'same-origin' }
  const download = await fetch(origin + endpoint + '/backups/' + file, { headers })
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /attachment/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), content)
  const forbidden = await fetch(origin + endpoint + '/backups/' + file, {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(forbidden.status, 403)

  const uploaded = 'upload-123e4567-e89b-42d3-a456-426614174000.dshbak'
  const bad = await fetch(origin + endpoint + '/uploads/' + uploaded, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream' }, body: content,
  })
  assert.equal(bad.status, 403, 'must require management header')
  const ok = await fetch(origin + endpoint + '/uploads/' + uploaded, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream',
      'x-dsh-management': '1' }, body: content,
  })
  assert.equal(ok.status, 201, await ok.text().catch(() => ''))
  assert.deepEqual(await readFile(join(root, 'uploads', uploaded)), content)
  assert.equal((await lstat(join(root, 'uploads', uploaded))).mode & 0o777, 0o600)
  const duplicate = await fetch(origin + endpoint + '/uploads/' + uploaded, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream',
      'x-dsh-management': '1' }, body: content,
  })
  assert.equal(duplicate.status, 409)
  const unsafe = await fetch(origin + endpoint + '/uploads/other.dshbak', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream',
      'x-dsh-management': '1' }, body: content,
  })
  assert.equal(unsafe.status, 400)
  await symlink(join(root, 'backups', file), join(root, 'backups', 'symlink.dshbak'))
  const linked = await fetch(origin + endpoint + '/backups/symlink.dshbak', { headers })
  assert.notEqual(linked.status, 200, 'must refuse symlink download')
  const oversized = await fetch(origin + endpoint + '/uploads/upload-123e4567-e89b-42d3-a456-426614174001.dshbak', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/octet-stream',
      'content-length': String(1024 * 1024 * 1024 + 1), 'x-dsh-management': '1' },
    body: Buffer.alloc(1),
  }).catch(() => null)
  // An HTTP client may reject forged Content-Length before reaching the server.
  if (oversized) assert.notEqual(oversized.status, 201)
})
