/**
 * billion-context browser UI compatibility for remote DSH Web deployments.
 * Every request goes through the existing DSH Connection authentication and
 * Host/Origin fence. No external listener, no arbitrary upstream URLs.
 * Agent/model requests continue using billion-context's original local origin.
 */
import http from 'node:http'

export const name = 'dsh-bili-domain-ui'
export const inject = ['connection', 'webServer']
// DSH's segment-prefix matcher appends "/" when matching child routes.
export const PREFIX = '/__bili'
const MAX_URL = 4096
const MAX_BODY = 128 * 1024
const MAX_RESPONSE = 16 * 1024 * 1024
const TIMEOUT_MS = 30000
const PERMITTED = Object.freeze([
  /^\/__bili\/$/,
  /^\/__bili\/(?:overview|stats|status|resign|config|memory|upstream|logs|diagnostics|session-report|cache-report|external-summary)(?:\/[a-z-]+)?$/,
  /^\/__bili\/sessions(?:\/[A-Za-z0-9_.~%-]{1,200}\/detail)?$/,
  /^\/__bili\/(?:conflicts\/clear|host-plugins\/dismiss|upstream\/test)$/,
  /^\/__bili\/replicas(?:\/[A-Za-z0-9_.~%-]{1,200}(?:\/restore)?)?$/
])
const ALLOWED_RESPONSE_HEADERS = [
  'content-type', 'content-disposition', 'etag', 'last-modified',
  'content-encoding', 'vary'
]

export function validAdminPath(pathname) {
  return typeof pathname === 'string' && PERMITTED.some(pattern => pattern.test(pathname))
}

export function parseProxyOrigin(value) {
  if (typeof value !== 'string' || value.length > 90) throw Error('invalid-bili-origin')
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
    || !parsed.port || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) throw Error('non-loopback-bili-origin')
  const port = Number(parsed.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('invalid-bili-port')
  // Avoid system DNS resolution and IPv6 availability differences for localhost.
  return 'http://127.0.0.1:' + port
}

function send(res, status, code) {
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(JSON.stringify({ error: code }))
}

function getJson(url, maxBytes = 1024) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3500, headers: { accept: 'application/json' } }, response => {
      if (response.statusCode !== 200 || !String(response.headers['content-type'] || '').includes('json')) {
        response.resume()
        reject(Error('bili-origin-unavailable'))
        return
      }
      let received = 0
      const parts = []
      response.on('data', buffer => {
        received += buffer.length
        if (received > maxBytes) { response.destroy(Error('oversized-bili-origin')); return }
        parts.push(buffer)
      })
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) }
        catch { reject(Error('invalid-bili-origin-response')) }
      })
      response.on('error', reject)
    })
    req.on('timeout', () => req.destroy(Error('bili-origin-timeout')))
    req.on('error', reject)
  })
}

/** Read live /bili/origin from this DSH Host; never trust a browser-provided URL. */
export async function resolveBiliOrigin(env = process.env) {
  const host = env.DSH_BIND_HOST
  const port = Number(env.DSH_PORT || 3080)
  // DSH_BIND_HOST is set by this image's resolver to a concrete container IP.
  if (!host || !/^[0-9a-fA-F:.]+$/.test(host)
    || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid-dsh-listener')
  const bind = host.includes(':') ? '[' + host + ']' : host
  const status = await getJson('http://' + bind + ':' + port + '/bili/origin')
  return parseProxyOrigin(status?.origin)
}

async function boundedBody(req) {
  const declared = Number(req.headers['content-length'] || 0)
  if (!Number.isSafeInteger(declared) || declared > MAX_BODY) throw Object.assign(Error('body-too-large'), { status: 413 })
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(Error('body-too-large'), { status: 413 })
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function proxyAdmin(req, res, origin, path, body) {
  return new Promise(resolve => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve() } }
    const url = new URL(path, origin)
    const headers = {
      host: url.host,
      accept: String(req.headers.accept || '*/*'),
      'accept-encoding': 'identity',
      'user-agent': 'DSH-bili-UI-bridge'
    }
    if (req.headers['content-type']) headers['content-type'] = String(req.headers['content-type'])
    if (body.length) headers['content-length'] = String(body.length)
    // billion-context requires loopback Host + Origin for its admin gate.
    // The external Origin is validated by DSH before it is rewritten here.
    if (req.method !== 'GET') headers.origin = origin
    const upstream = http.request(url, { method: req.method, headers, timeout: TIMEOUT_MS }, incoming => {
      const length = Number(incoming.headers['content-length'] || 0)
      if (Number.isFinite(length) && length > MAX_RESPONSE) {
        incoming.destroy()
        send(res, 502, 'bili-response-too-large')
        finish()
        return
      }
      if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
        const loc = String(incoming.headers.location || '')
        if (!loc.startsWith('/__bili/') || loc.startsWith('//')) {
          incoming.resume()
          send(res, 502, 'unsafe-bili-redirect')
          finish()
          return
        }
      }
      const out = {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'referrer-policy': 'no-referrer'
      }
      for (const key of ALLOWED_RESPONSE_HEADERS) {
        if (incoming.headers[key] !== undefined) out[key] = incoming.headers[key]
      }
      if (incoming.headers.location && incoming.statusCode >= 300 && incoming.statusCode < 400) {
        out.location = incoming.headers.location
      }
      res.writeHead(incoming.statusCode || 502, out)
      let streamed = 0
      incoming.on('data', part => {
        streamed += part.length
        if (streamed > MAX_RESPONSE) {
          incoming.destroy()
          res.destroy()
        } else if (!res.destroyed) {
          if (!res.write(part)) incoming.pause()
        }
      })
      res.on('drain', () => incoming.resume())
      incoming.on('end', () => { if (!res.writableEnded) res.end(); finish() })
      incoming.on('error', () => { if (!res.destroyed) res.destroy(); finish() })
    })
    upstream.on('timeout', () => upstream.destroy(Error('bili-upstream-timeout')))
    upstream.on('error', () => { send(res, 502, 'bili-upstream-unavailable'); finish() })
    res.on('close', () => { upstream.destroy(); finish() })
    upstream.end(body)
  })
}

/** An injected authenticated Connection service can be tested independently. */
export async function handleBiliUi(req, res, connection, resolver = resolveBiliOrigin) {
  const verdict = connection?.admit?.(req)
  if (!verdict || 'rejection' in verdict) {
    return send(res, verdict?.rejection === 403 ? 403 : 401, 'dsh-auth-required')
  }
  if (verdict.peer?.principal?.kind !== 'owner') return send(res, 403, 'owner-required')
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return send(res, 405, 'method-not-allowed')
  if (!req.url || req.url.length > MAX_URL) return send(res, 400, 'invalid-path')
  let url
  try { url = new URL(req.url, 'http://dsh.internal') }
  catch { return send(res, 400, 'invalid-path') }
  if (!validAdminPath(url.pathname) || /%2f|%5c|%00/i.test(url.pathname)) {
    return send(res, 404, 'route-not-available')
  }
  if (req.method === 'GET' && Number(req.headers['content-length'] || 0) > 0) {
    return send(res, 400, 'unexpected-body')
  }
  // CSRF: mutating requests require a matching external Host + Origin. The
  // upstream must never see arbitrary browser headers or DSH session cookies.
  if (req.method !== 'GET') {
    let origin
    try { origin = new URL(String(req.headers.origin || '')) }
    catch { return send(res, 403, 'same-origin-required') }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host
      || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'same-origin-required')
  }
  let body = Buffer.alloc(0)
  try {
    if (req.method !== 'GET') body = await boundedBody(req)
    const upstreamOrigin = await resolver()
    return await proxyAdmin(req, res, parseProxyOrigin(upstreamOrigin), url.pathname + url.search, body)
  } catch (error) {
    if (!res.writableEnded) send(res, error?.status || 503, 'bili-bridge-unavailable')
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handleBiliUi(req, res, ctx.connection)
  }), 'dsh bili same-origin authenticated UI')
}
export default { name, inject, apply }
