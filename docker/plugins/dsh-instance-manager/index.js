import { open, readdir, link, unlink, lstat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-docker-instance-manager'
export const inject = []
export const ENDPOINT = '/api/dsh-docker-instance-manager'
export const LOGS_ENDPOINT = ENDPOINT + '/logs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ARCHIVE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.dshbak$/
const INSTANCE_ID = /^[a-z][a-z0-9-]{0,31}$/
const MAX_UPLOAD = 1024 * 1024 * 1024
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const SIMPLE = new Set(['check', 'update', 'restart', 'recreate', 'rollback', 'cleanup',
  'proxy-start', 'proxy-stop', 'proxy-restart', 'proxy-test', 'proxy-test-all', 'proxy-refresh',
  'edition-standard', 'edition-research', 'pack-none', 'pack-economics',
  'diagnose-environment', 'diagnose-storage', 'diagnose-plugins',
  'dashboard-start', 'dashboard-stop', 'backup-export', 'backup-auto-off'])
// Legacy workers do not advertise capabilities. Keep Phase 1 actions
// backward-compatible, but never send newly introduced mutations to a host
// whose executor version cannot be identified.
const REQUIRES_HOST_CAPABILITIES = new Set([
  'edition-standard', 'edition-research', 'pack-none', 'pack-economics',
  'diagnose-environment', 'diagnose-storage', 'diagnose-plugins',
  'dashboard-start', 'dashboard-stop', 'backup-export', 'backup-verify', 'backup-import', 'backup-auto-on', 'backup-auto-off',
])
export const OPERATION_CONTRACT_VERSION = 1
export const SUPPORTED_OPERATIONS = Object.freeze([...SIMPLE, 'settings', 'proxy-use', 'proxy-add', 'proxy-subscribe', 'backup-verify', 'backup-import', 'backup-auto-on'].sort())
const busy = job => ['queued', 'running'].includes(job.state)
const offline = status => {
  const age = Date.now() - Date.parse(status?.heartbeat)
  return !Number.isFinite(age) || age > 180000 || age < -300000
}

class Refusal extends Error {
  constructor(status, message) { super(message); this.status = status }
}
function refuse(status, message) { throw new Refusal(status, message) }

export function validate(action, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) refuse(400, 'invalid-arguments')
  const keys = Object.keys(args).sort().join(',')
  if (SIMPLE.has(action) && !keys) return
  if (action === 'settings' && keys === 'checkInterval'
    && [0, 3600, 21600, 86400].includes(args.checkInterval)) return
  if (action === 'proxy-use' && keys === 'name' && typeof args.name === 'string'
    && NODE_NAME.test(args.name)) return
  if (['proxy-add', 'proxy-subscribe'].includes(action) && keys === 'name,url'
    && typeof args.name === 'string' && NODE_NAME.test(args.name)
    && typeof args.url === 'string' && args.url.length <= 8192 && !/[\x00-\x20\x7f]/.test(args.url)
    && (action === 'proxy-subscribe' ? /^https?:\/\// : /^(https?|socks5?|vless|trojan|hysteria2|ss):\/\//).test(args.url)) return
  if (action === 'backup-verify' && keys === 'file' && typeof args.file === 'string'
    && ARCHIVE.test(args.file)) return
  if (action === 'backup-import' && keys === 'file,instance' && typeof args.file === 'string'
    && ARCHIVE.test(args.file) && typeof args.instance === 'string'
    && INSTANCE_ID.test(args.instance) && args.instance !== 'default') return
  if (action === 'backup-auto-on' && keys === 'cadence,keep'
    && ['daily', 'weekly'].includes(args.cadence) && Number.isInteger(args.keep)
    && args.keep >= 1 && args.keep <= 90) return
  refuse(400, 'unsupported-operation')
}

async function readJSON(path, limit = 262144) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) refuse(503, 'unsafe-management-file')
    const text = await file.readFile('utf8')
    if (Buffer.byteLength(text) > limit) refuse(503, 'oversized-management-file')
    return JSON.parse(text)
  } finally { await file.close() }
}

export class HostBridge {
  constructor(root = process.env.DSH_MANAGEMENT_BRIDGE || '/run/dsh-management') {
    this.requests = join(root, 'requests')
    this.results = join(root, 'results')
  }
  async guard() {
    for (const directory of [this.requests, this.results]) {
      const info = await lstat(directory)
      if (info.isSymbolicLink() || !info.isDirectory()) refuse(503, 'unsafe-management-directory')
    }
  }
  async status() {
    try { await this.guard() } catch (error) {
      if (error.code === 'ENOENT') return { configured: false, online: false, status: null, jobs: [] }
      throw error
    }
    const status = await readJSON(join(this.results, 'status.json')).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    const entries = (await readdir(this.results)).filter(file => file.endsWith('.json') && UUID.test(file.slice(0, -5)))
    const jobs = await Promise.all(entries.map(file => readJSON(join(this.results, file)).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })))
    const pending = (await readdir(this.requests)).filter(file => file.endsWith('.json') && UUID.test(file.slice(0, -5)))
    const known = new Set(jobs.filter(Boolean).map(job => job.id))
    for (const file of pending) {
      const id = file.slice(0, -5)
      if (!known.has(id)) jobs.push({ id, state: 'queued', action: 'pending' })
    }
    return {
      configured: true, online: !offline(status), status,
      jobs: jobs.filter(Boolean).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, 50),
    }
  }
  async logStream() {
    await this.guard()
    const stream = await readJSON(join(this.results, 'log-stream.json'), 65536)
      .catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!stream) return null
    if (!UUID.test(stream.generation) || !Number.isSafeInteger(stream.seq) || stream.seq < 0
      || !Array.isArray(stream.entries) || stream.entries.length > 200
      || stream.entries.some(item => !Number.isSafeInteger(item?.seq)
        || item.seq < 1 || item.seq > stream.seq
        || typeof item.text !== 'string' || item.text.length > 8192)
      || typeof stream.updatedAt !== 'string' || stream.updatedAt.length > 64) {
      refuse(503, 'invalid-log-stream')
    }
    return stream
  }
  async submit(data) {
    if (!data || Object.keys(data).sort().join(',') !== 'action,arguments,id'
      || typeof data.id !== 'string' || !UUID.test(data.id)) refuse(400, 'invalid-task')
    validate(data.action, data.arguments)
    const snapshot = await this.status()
    const previous = snapshot.jobs.find(job => job.id === data.id)
    if (previous) return { id: previous.id, state: previous.state }
    if (!snapshot.online) refuse(503, 'host-executor-offline')
    // Older workers publish no management metadata and retain the previous
    // behavior. New workers advertise capabilities so Web cannot submit an
    // operation the running host executable does not understand.
    const management = snapshot.status?.management
    if (!management && REQUIRES_HOST_CAPABILITIES.has(data.action)) refuse(503, 'host-operation-unavailable')
    if (management && (management.schema !== OPERATION_CONTRACT_VERSION
      || !Array.isArray(management.operations) || !management.operations.includes(data.action))) {
      refuse(503, 'host-operation-unavailable')
    }
    if (snapshot.jobs.some(busy)) refuse(409, 'instance-busy')
    const destination = join(this.requests, data.id + '.json')
    const tmp = join(this.requests, '.' + randomUUID() + '.tmp')
    const file = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try {
      await file.writeFile(JSON.stringify({ ...data, createdAt: new Date().toISOString() }))
      await file.sync()
    } finally { await file.close() }
    try { await link(tmp, destination) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    finally { await unlink(tmp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    return { id: data.id, state: 'queued' }
  }
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(value))
}
async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 12288) refuse(413, 'request-too-large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { refuse(400, 'invalid-json') }
}

const MAX_LOG_CLIENTS = 6
let openLogClients = 0

/**
 * Authenticated SSE endpoint: initial bounded snapshot, then only new lines.
 * EventSource reconnects automatically, carrying Last-Event-ID when possible.
 * This tailing endpoint never executes Docker or writes to the host.
 */
export async function serveLogStream(req, res, bridge, logger = () => {}) {
  if (openLogClients >= MAX_LOG_CLIENTS) return send(res, 429, { error: 'too-many-log-streams' })
  const status = await bridge.status()
  if (!status.configured) return send(res, 503, { error: 'host-executor-unconfigured' })

  openLogClients++
  let stopped = false
  let checking = false
  let lastGeneration = ''
  let lastSequence = -1
  let hadError = false
  let latestEvent = String(req.headers['last-event-id'] || '')
  const match = /^([0-9a-f-]{36}):(\d{1,15})$/.exec(latestEvent)
  if (match) {
    lastGeneration = match[1]
    lastSequence = Number(match[2])
  }

  const write = value => {
    if (stopped || res.writableEnded || res.destroyed) return false
    try {
      // Under backpressure, close and let EventSource resume with its event id;
      // never accumulate unbounded browser-facing output.
      if (res.write(value) === false) { res.end(); stop(); return false }
      return true
    } catch { stop(); return false }
  }
  const event = (name, payload, id) => write(
    (id ? 'id: ' + id + '\n' : '') +
    'event: ' + name + '\ndata: ' + JSON.stringify(payload) + '\n\n'
  )
  let pollTimer, heartbeatTimer
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
    openLogClients--
    if (!res.writableEnded && !res.destroyed) res.end()
  }
  res.on('close', stop)
  req.on?.('aborted', stop)
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  })
  res.flushHeaders?.()
  write('retry: 1500\n\n')
  const poll = async () => {
    if (stopped || checking) return
    checking = true
    try {
      const stream = await bridge.logStream()
      if (stopped) return
      if (!stream) {
        if (!hadError) event('status', { state: 'waiting', message: 'host-log-stream-not-ready' })
        hadError = true
        return
      }
      hadError = false
      const first = stream.entries[0]?.seq ?? (stream.seq + 1)
      const restart = lastGeneration !== stream.generation
        || lastSequence < first - 1 || lastSequence > stream.seq
      const fresh = restart ? stream.entries : stream.entries.filter(item => item.seq > lastSequence)
      if (restart || fresh.length) {
        if (event('logs', {
          mode: restart ? 'snapshot' : 'append',
          lines: fresh.map(item => item.text),
          generation: stream.generation,
          seq: stream.seq,
          updatedAt: stream.updatedAt,
        }, stream.generation + ':' + stream.seq)) {
          lastGeneration = stream.generation
          lastSequence = stream.seq
        }
      }
    } catch (error) {
      logger(error)
      if (!hadError) event('status', { state: 'error', message: 'host-log-stream-unavailable' })
      hadError = true
    } finally {
      checking = false
    }
  }
  pollTimer = setInterval(() => { void poll() }, 350)
  heartbeatTimer = setInterval(() => { write(': heartbeat\n\n') }, 15000)
  void poll()
}

// Only authenticated DSH owners can use these handlers. Archives contain
// plaintext tokens: never expose the underlying directories with static HTTP.
function transferLocation(name) {
  if (typeof name !== 'string' || !ARCHIVE.test(name)) refuse(400, 'invalid-backup-file')
  const root = process.env.DSH_MANAGEMENT_BRIDGE || '/run/dsh-management'
  return join(root, name.startsWith('upload-') ? 'uploads' : 'backups', name)
}
async function guardTransferDir(name) {
  const root = process.env.DSH_MANAGEMENT_BRIDGE || '/run/dsh-management'
  const directory = join(root, name.startsWith('upload-') ? 'uploads' : 'backups')
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) refuse(503, 'backup-storage-unavailable')
}
async function downloadBackup(res, name) {
  await guardTransferDir(name)
  const descriptor = await open(transferLocation(name), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await descriptor.stat()
    if (!info.isFile() || !info.size) refuse(404, 'backup-file-missing')
    res.writeHead(200, { 'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="' + name + '"',
      'content-length': info.size, 'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff' })
    await pipeline(descriptor.createReadStream({ autoClose: false }), res)
  } finally { await descriptor.close() }
}
async function uploadBackup(req, name) {
  if (!/^upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.dshbak$/.test(name)) refuse(400, 'invalid-backup-file')
  await guardTransferDir(name)
  const rawLength = req.headers['content-length']
  const declared = rawLength === undefined ? null : Number(rawLength)
  if (declared !== null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_UPLOAD))
    refuse(413, 'backup-too-large')
  const directory = join(process.env.DSH_MANAGEMENT_BRIDGE || '/run/dsh-management', 'uploads')
  // Bound uploads in the shared spool; incomplete files are never selectable.
  let bytesUsed = 0
  for (const entry of await readdir(directory)) {
    if (!/^upload-[0-9a-f-]{36}\.dshbak$/.test(entry)) continue
    const meta = await lstat(join(directory, entry))
    if (!meta.isSymbolicLink() && meta.isFile()) bytesUsed += meta.size
  }
  if (bytesUsed + (declared || MAX_UPLOAD) > 2 * MAX_UPLOAD) refuse(413, 'backup-storage-full')
  const temporary = join(directory, '.uploading-' + name + '.part')
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let size = 0
  try {
    for await (const block of req) {
      size += block.length
      if (size > MAX_UPLOAD || (declared !== null && size > declared)) refuse(413, 'backup-too-large')
      let offset = 0
      while (offset < block.length) {
        const { bytesWritten } = await file.write(block, offset, block.length - offset)
        if (!bytesWritten) throw Error('short archive write')
        offset += bytesWritten
      }
    }
    if (!size || (declared !== null && size !== declared)) refuse(400, 'incomplete-backup-upload')
    await file.sync()
  } catch (error) {
    await file.close()
    await unlink(temporary).catch(() => {})
    throw error
  }
  await file.close()
  const destination = transferLocation(name)
  try {
    // The ID was a fresh UUID, but still refuse clobber if it already exists.
    const existing = await lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing) refuse(409, 'duplicate-backup-file')
    await import('node:fs/promises').then(fs => fs.rename(temporary, destination))
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return { file: name, size }
}

export function apply(ctx) {
  const bridge = new HostBridge()
  let tail = Promise.resolve()
  // connection/request is downstream of DSH's normal browser authentication.
  ctx.on('connection/request', async (req, res, next) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    const backupPath = pathname.startsWith(ENDPOINT + '/backups/')
      ? pathname.slice((ENDPOINT + '/backups/').length) : null
    const uploadPath = pathname.startsWith(ENDPOINT + '/uploads/')
      ? pathname.slice((ENDPOINT + '/uploads/').length) : null
    if (pathname !== ENDPOINT && pathname !== LOGS_ENDPOINT
      && backupPath === null && uploadPath === null) return next()
    if (backupPath !== null || uploadPath !== null) {
      if ((backupPath !== null && req.method !== 'GET') ||
          (uploadPath !== null && req.method !== 'POST')) return send(res, 405, { error: 'method-not-allowed' })
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
        return send(res, 403, { error: 'same-origin-request-required' })
      if (uploadPath !== null && (req.headers['x-dsh-management'] !== '1' ||
          req.headers['content-type'] !== 'application/octet-stream' ||
          req.headers['sec-fetch-site'] === 'none'))
        return send(res, 403, { error: 'same-origin-request-required' })
      try {
        if (backupPath !== null) {
          if (!ARCHIVE.test(backupPath)) return send(res, 400, { error: 'invalid-backup-file' })
          return await downloadBackup(res, backupPath)
        }
        return send(res, 201, await uploadBackup(req, uploadPath))
      } catch (error) {
        ctx.logger?.warn?.('dsh backup transfer: ' + (error instanceof Refusal ? error.message : 'transfer unavailable'))
        if (!res.headersSent) return send(res, error instanceof Refusal ? error.status
          : error?.code === 'EEXIST' ? 409 : error?.code === 'ENOENT' ? 404 : 503,
          { error: error instanceof Refusal ? error.message : 'backup-transfer-unavailable' })
      }
      return
    }
    if (pathname === LOGS_ENDPOINT) {
      if (req.method !== 'GET') return send(res, 405, { error: 'method-not-allowed' })
      if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
        return send(res, 403, { error: 'same-origin-request-required' })
      try { return await serveLogStream(req, res, bridge, error =>
        ctx.logger?.warn?.('dsh live logs: ' + String(error))) }
      catch (error) { if (!res.headersSent) send(res, 503, { error: 'log-stream-unavailable' }) }
      return
    }
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method-not-allowed' })
    if (req.method === 'POST' && (req.headers['x-dsh-management'] !== '1'
      || !String(req.headers['content-type'] || '').startsWith('application/json')
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))) {
      return send(res, 403, { error: 'same-origin-request-required' })
    }
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    try {
      if (req.method === 'GET') return send(res, 200, await bridge.status())
      return send(res, 202, await bridge.submit(await body(req)))
    } catch (error) {
      ctx.logger?.warn?.('dsh instance manager: ' + (error instanceof Refusal ? error.message : 'bridge unavailable'))
      if (!res.writableEnded) send(res, error instanceof Refusal ? error.status : 503,
        { error: error instanceof Refusal ? error.message : 'management-unavailable' })
    } finally { release() }
  })
}
