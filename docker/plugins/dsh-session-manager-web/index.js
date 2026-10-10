/**
 * DSH Docker Web session-manager host.
 * Shares the official authenticated Connection /api request waterfall.
 * Never touches session logs while DSH is running: it only queues a request
 * for the entrypoint's offline, pre-boot deletion reconciler.
 */
import { readdir, lstat, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

export const inject = ['sessionPersistence']
export const ENDPOINT = '/api/dsh-docker-session-manager/delete'
const VALID_ID = /^session-[A-Za-z0-9_-]{1,120}$/
const VALID_SEGMENT = /^[A-Za-z0-9_.~%-]+$/

async function realDirectory(path) {
  const stat = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  return stat?.isDirectory() && !stat.isSymbolicLink()
}

async function storedKey(home, sessionId) {
  const root = join(home, 'sessions')
  if (!await realDirectory(root)) return null
  let matched = null
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory() || !VALID_SEGMENT.test(project.name) || project.name === '..') continue
    const projectDir = join(root, project.name)
    if (!await realDirectory(projectDir)) continue
    const sessionDir = join(projectDir, sessionId)
    if (!await realDirectory(sessionDir)) continue
    if (matched !== null) throw new Error('duplicate session directories: refusing deletion')
    matched = project.name + '/' + sessionId
  }
  return matched
}

async function readBody(req) {
  let bytes = 0
  const chunks = []
  for await (const part of req) {
    const buffer = Buffer.from(part)
    bytes += buffer.length
    if (bytes > 4096) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res, code, value) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  ctx.on('connection/request', async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== ENDPOINT) return next()
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' })
    try {
      const data = await readBody(req)
      const id = data?.sessionId
      if (typeof id !== 'string' || !VALID_ID.test(id)) {
        return send(res, 400, { error: 'invalid-session-id' })
      }
      const home = process.env.DSH_HOME || '/root/.dsh'
      if (!await realDirectory(home)) {
        return send(res, 503, { error: 'invalid-dsh-home' })
      }
      // The canonical provider must know the requested session, not just some
      // unrecognized directory with a similarly named segment.
      const canonical = await ctx.sessionPersistence.stat(id)
      if (!canonical || canonical.header?.id !== id) {
        return send(res, 404, { error: 'session-not-found' })
      }
      const key = await storedKey(home, id)
      if (key === null) return send(res, 404, { error: 'session-not-materialized' })
      const queueDir = join(home, '.dshd-session-manager')
      if (await realDirectory(queueDir) === false) {
        // A pre-existing file or symlink must never be followed.
        const existing = await lstat(queueDir).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
        if (existing) return send(res, 409, { error: 'unsafe-queue-directory' })
      }
      await mkdir(queueDir, { recursive: true, mode: 0o700 })
      const queueFile = join(queueDir, 'pending')
      const fstat = await lstat(queueFile).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (fstat && (!fstat.isFile() || fstat.isSymbolicLink())) {
        return send(res, 409, { error: 'unsafe-queue-file' })
      }
      const file = await open(queueFile, 'a', 0o600)
      try {
        await file.appendFile(key + '\n')
        await file.sync()
      } finally {
        await file.close()
      }
      const restarting = process.env.DSH_DOCKER_RESTART === 'container'
      send(res, 202, { queued: true, restartScheduled: restarting })
      if (restarting) {
        // Mirror this distribution's dsh-market Docker restart adapter:
        // the outer Docker restart policy recreates the entrypoint, where
        // the pending queue is applied before the Session store is opened.
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 800).unref()
      }
    } catch (error) {
      ctx.logger?.warn?.('dsh-docker-session-manager: request failed: ' + String(error))
      if (!res.writableEnded) send(res, 500, { error: 'session-deletion-failed' })
    }
  })
}
