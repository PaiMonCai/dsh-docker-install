/**
 * Web-only DSH session lifecycle extension.
 *
 * "Delete" is a reversible, durable trash mark on DSH's native archive set.
 * Its session files stay in place so an active persistence handle is never
 * renamed out from under the running Web process. "Permanently delete" takes
 * a per-session exclusive write lease, rejects live sessions, moves the
 * cold directory out of the session root and purges it without restarting DSH.
 * All routes sit behind the standard authenticated connection/request gate.
 */
import { readdir, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const inject = ['sessionPersistence', 'workspaceRegistry', 'sessions', 'agents']
export const ENDPOINT = '/api/dsh-docker-session-manager'
const ID = /^session-[A-Za-z0-9_-]{1,120}$/
const SEGMENT = /^[A-Za-z0-9_.~%-]+$/
const LIMIT = 4096

class Refusal extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
const deny = (status, code) => { throw new Refusal(status, code) }
const assertId = id => {
  if (typeof id !== 'string' || !ID.test(id)) deny(400, 'invalid-session-id')
  return id
}
async function realDir(path) {
  const value = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  return !!value && value.isDirectory() && !value.isSymbolicLink()
}
async function safeHome() {
  const home = process.env.DSH_HOME || '/root/.dsh'
  if (!await realDir(home)) deny(503, 'invalid-dsh-home')
  return home
}
function trashDir(home) { return join(home, '.dshd-session-trash-v2') }
function recordFile(home, id) { return join(trashDir(home), id + '.json') }

async function prepareTrash(home) {
  const dir = trashDir(home)
  const st = await lstat(dir).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
  if (st && (!st.isDirectory() || st.isSymbolicLink())) deny(409, 'unsafe-trash-directory')
  if (!st) await mkdir(dir, { mode: 0o700 })
  return dir
}
async function recordOf(home, id) {
  const path = recordFile(home, id)
  const st = await lstat(path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
  if (!st) return null
  if (!st.isFile() || st.isSymbolicLink() || st.size > LIMIT) deny(409, 'unsafe-trash-record')
  const record = JSON.parse(await readFile(path, 'utf8'))
  if (record?.sessionId !== id || typeof record.deletedAt !== 'string'
    || typeof record.title !== 'string') deny(409, 'invalid-trash-record')
  return record
}
async function saveRecord(home, record) {
  await prepareTrash(home)
  const file = await open(recordFile(home, record.sessionId), 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(record) + '\n')
    await file.sync()
  } finally { await file.close() }
}
async function discardRecord(home, id) {
  await rm(recordFile(home, id), { force: true })
}

// Only materialized first-party JSONL directories can be deleted. Symlinks,
// ambiguous IDs, and absent storage are all refused; never resolve user paths.
async function locateSession(home, id) {
  const root = join(home, 'sessions')
  if (!await realDir(root)) return null
  let target = null
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory() || !SEGMENT.test(project.name)
      || project.name === '.' || project.name === '..') continue
    const parent = join(root, project.name)
    if (!await realDir(parent)) continue
    const dir = join(parent, id)
    if (!await realDir(dir)) continue
    if (target) deny(409, 'ambiguous-session-directory')
    target = dir
  }
  return target
}
function active(ctx, id) {
  return !!ctx.sessions.get(id) || !!ctx.agents.get(id)
}

async function listTrash(home) {
  const dir = trashDir(home)
  if (!await realDir(dir)) {
    const st = await lstat(dir).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
    if (st) deny(409, 'unsafe-trash-directory')
    return []
  }
  const records = []
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    if (!ID.test(id)) continue
    const record = await recordOf(home, id)
    if (record) records.push(record)
  }
  return records.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

async function moveToTrash(ctx, home, id, title) {
  const existing = await recordOf(home, id)
  if (existing) return { trashed: true, existing: true }
  const session = await ctx.sessionPersistence.stat(id)
  if (!session || session.header?.id !== id || !await locateSession(home, id)) {
    deny(404, 'session-not-found')
  }
  if (active(ctx, id) && ctx.agents.get(id)?.status === 'running') deny(409, 'session-active')
  try {
    // DSH itself checks all registered work sources (turns, jobs, schedules)
    // and refuses the transition if any still has work, without stopping it.
    await ctx.workspaceRegistry.archiveSession(id)
  } catch (error) {
    if (/active|running|activity/i.test(String(error))) deny(409, 'session-active')
    throw error
  }
  try {
    await saveRecord(home, {
      sessionId: id, title: title || id, deletedAt: new Date().toISOString(),
    })
  } catch (error) {
    await ctx.workspaceRegistry.unarchiveSession(id).catch(() => {})
    throw error
  }
  return { trashed: true }
}

async function restore(ctx, home, id) {
  if (!await recordOf(home, id)) deny(404, 'not-in-trash')
  if (!await ctx.sessionPersistence.stat(id)) deny(409, 'session-storage-missing')
  await ctx.workspaceRegistry.unarchiveSession(id)
  await discardRecord(home, id)
  return { restored: true }
}

async function erase(ctx, home, id, fromTrash) {
  const record = await recordOf(home, id)
  if (fromTrash && !record) deny(404, 'not-in-trash')
  const known = await ctx.sessionPersistence.stat(id)
  if (!known || known.header?.id !== id) deny(404, 'session-not-found')
  if (active(ctx, id)) deny(409, 'session-in-use')
  // Archive first, preventing new work from being admitted by DSH's native
  // workspace activity gate. Do NOT auto-stop an in-flight Agent.
  const wasArchived = ctx.workspaceRegistry.archivedSessionIds?.has?.(id)
    || ctx.workspaceRegistry.archivedSessionIds?.includes?.(id) || false
  if (!wasArchived) {
    try { await ctx.workspaceRegistry.archiveSession(id) }
    catch (error) {
      if (/active|running|activity/i.test(String(error))) deny(409, 'session-active')
      throw error
    }
  }
  let handle
  let moved = false
  try {
    // Upstream holds both an in-process claim and an OS session.lock lease for
    // the duration of this write handle. If another writer exists, fail closed.
    try { handle = await ctx.sessionPersistence.open(id, 'write') }
    catch (error) {
      if (/owned|lock|busy|lease|already/i.test(String(error))) deny(409, 'session-in-use')
      throw error
    }
    if (active(ctx, id)) deny(409, 'session-in-use')
    const source = await locateSession(home, id)
    if (!source) deny(404, 'session-not-materialized')
    const dir = await prepareTrash(home)
    const purgePath = join(dir, '.purge-' + randomUUID())
    await rename(source, purgePath)
    moved = true
    // Release the writer lease before unlinking its inode.
    await handle.close()
    handle = null
    await rm(purgePath, { recursive: true, force: true })
    await discardRecord(home, id)
    await ctx.workspaceRegistry.unarchiveSession(id)
    // Signal native client session lists to shed a now-absent row immediately.
    ctx.emit?.('api-session/removed', id)
    return { purged: true }
  } finally {
    if (handle) await handle.close()
    if (!moved && !wasArchived) {
      await ctx.workspaceRegistry.unarchiveSession(id).catch(() => {})
    }
  }
}

async function body(req) {
  let total = 0
  const chunks = []
  for await (const item of req) {
    const buf = Buffer.from(item)
    total += buf.length
    if (total > LIMIT) deny(413, 'request-too-large')
    chunks.push(buf)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { deny(400, 'invalid-json') }
}
function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

// One request at a time per running Host avoids two UI tabs competing for the
// same trash record. No Docker stop or restart is scheduled here.
export function apply(ctx) {
  let tail = Promise.resolve()
  ctx.on('connection/request', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ENDPOINT) return next()
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method-not-allowed' })
    if (req.method === 'POST' && !['application/json', 'application/json; charset=utf-8']
      .includes((req.headers?.['content-type'] || 'application/json').toLowerCase())) {
      return send(res, 415, { error: 'unsupported-media-type' })
    }
    const previous = tail
    let release
    tail = new Promise(resolve => { release = resolve })
    await previous
    try {
      const home = await safeHome()
      if (req.method === 'GET') return send(res, 200, { items: await listTrash(home) })
      const data = await body(req)
      const id = assertId(data?.sessionId)
      let result
      switch (data?.action) {
        case 'trash':
          if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 160)) deny(400, 'invalid-title')
          result = await moveToTrash(ctx, home, id, data.title?.trim())
          break
        case 'restore': result = await restore(ctx, home, id); break
        case 'permanent': result = await erase(ctx, home, id, false); break
        case 'purge': result = await erase(ctx, home, id, true); break
        default: deny(400, 'invalid-action')
      }
      send(res, 200, result)
    } catch (error) {
      if (!(error instanceof Refusal)) ctx.logger?.warn?.('dsh session-manager: ' + String(error))
      if (!res.writableEnded) send(res, error instanceof Refusal ? error.status : 500,
        { error: error instanceof Refusal ? error.code : 'operation-failed' })
    } finally { release() }
  })
}
