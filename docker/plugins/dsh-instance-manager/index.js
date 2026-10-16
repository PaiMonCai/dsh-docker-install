import { open, readdir, link, unlink, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-docker-instance-manager'
export const inject = []
export const ENDPOINT = '/api/dsh-docker-instance-manager'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const SIMPLE = new Set(['check', 'update', 'restart', 'recreate', 'rollback', 'cleanup',
  'proxy-start', 'proxy-stop', 'proxy-restart', 'proxy-test', 'proxy-test-all', 'proxy-refresh'])
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
  async submit(data) {
    if (!data || Object.keys(data).sort().join(',') !== 'action,arguments,id'
      || typeof data.id !== 'string' || !UUID.test(data.id)) refuse(400, 'invalid-task')
    validate(data.action, data.arguments)
    const snapshot = await this.status()
    const previous = snapshot.jobs.find(job => job.id === data.id)
    if (previous) return { id: previous.id, state: previous.state }
    if (!snapshot.online) refuse(503, 'host-executor-offline')
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

export function apply(ctx) {
  const bridge = new HostBridge()
  let tail = Promise.resolve()
  // connection/request is downstream of DSH's normal browser authentication.
  ctx.on('connection/request', async (req, res, next) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== ENDPOINT) return next()
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
