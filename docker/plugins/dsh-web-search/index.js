/**
 * DSH Web Search provider. The search process is a child of DSH, not a Docker
 * sidecar. No host port or Docker socket required; only a loopback listener.
 */
import { SearchRouter } from './router.js'
import { SearchCache } from './cache.js'
import { BraveBudget } from './budget.js'
import { EmbeddedSearxng, SEARCH_ENDPOINT } from './embedded.js'
import { SearchSettings, defaults, validate } from './settings.js'

export const name = 'dsh-docker-web-search'
export const inject = ['web']
export const ENDPOINT = '/api/dsh-docker-web-search'
const BODY_LIMIT = 4096

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(data))
}
async function parseBody(req) {
  let bytes = 0
  const parts = []
  for await (const part of req) {
    bytes += part.length
    if (bytes > BODY_LIMIT) throw new Error('request-too-large')
    parts.push(part)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

export function apply(ctx) {
  const store = new SearchSettings()
  const preferences = defaults()
  const warn = message => ctx.logger?.warn?.('dsh web search: ' + String(message))
  const embedded = new EmbeddedSearxng({ log: warn })
  const budget = new BraveBudget({
    path: (process.env.DSH_HOME || '/root/.dsh') + '/web-search/brave-budget.json',
    dailyLimit: preferences.braveDailyLimit,
  })
  const router = new SearchRouter({
    searxngURL: SEARCH_ENDPOINT,
    enabled: true,
    prepare: async () => { await loaded; if (!preferences.enabled) throw new Error('search-disabled'); await embedded.ensureStarted() },
    braveEnabled: preferences.braveEnabled,
    resolveBraveKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials) return (await credentials.resolve('BRAVE_SEARCH_API_KEY'))?.value
      return process.env.BRAVE_SEARCH_API_KEY || undefined
    },
    braveBudget: budget,
    timeoutMs: 11500,
    searxngTimeoutMs: 7000,
    braveTimeoutMs: 4000,
    cacheEnabled: preferences.cacheEnabled,
  })
  const sync = () => {
    router.options.enabled = preferences.enabled
    router.options.braveEnabled = preferences.braveEnabled
    router.options.cacheEnabled = preferences.cacheEnabled
    budget.dailyLimit = preferences.braveDailyLimit
    router.cache = new SearchCache({ maxEntries: 500, maxBytes: 32 * 1024 * 1024 })
  }
  let configurationError = null
  const loaded = store.load(preferences).then(saved => {
    Object.assign(preferences, saved)
    sync()
  }).catch(error => {
    configurationError = 'Saved search settings are invalid. Repair the configuration on disk.'
    preferences.enabled = false
    sync()
    warn(error)
  })
  ctx.web.registerSearchProvider(router)

  // Don't delay DSH Web startup, but prewarm the search child so the first
  // request usually avoids SearXNG cold-start latency.
  void loaded.then(async () => {
    if (preferences.enabled) await embedded.ensureStarted()
  }).catch(warn)
  process.once('exit', () => { embedded.child?.kill('SIGTERM') })

  let pending = Promise.resolve()
  ctx.on('connection/request', async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== ENDPOINT) return next()
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method-not-allowed' })
    if (req.method === 'POST' && (req.headers['x-dsh-search-settings'] !== '1'
      || !String(req.headers['content-type'] || '').startsWith('application/json'))) {
      return send(res, 403, { error: 'same-origin-settings-request-required' })
    }
    const previous = pending
    let release
    pending = new Promise(resolve => { release = resolve })
    await previous
    try {
      await loaded
      if (req.method === 'GET') return send(res, 200, {
        settings: preferences, running: await embedded.running(),
        error: configurationError,
      })
      const data = await parseBody(req)
      if (data?.action === 'save') {
        if (configurationError) throw new Error('repair-settings-on-disk-first')
        const nextPreferences = validate(data.settings)
        await store.save(nextPreferences)
        Object.assign(preferences, nextPreferences)
        sync()
        if (preferences.enabled) void embedded.ensureStarted().catch(warn)
        else await embedded.stop()
        return send(res, 200, { settings: preferences, running: await embedded.running() })
      }
      if (data?.action === 'restart') {
        if (!preferences.enabled) return send(res, 409, { error: 'search-is-disabled' })
        await embedded.stop()
        await embedded.ensureStarted()
        return send(res, 200, { running: true })
      }
      if (data?.action === 'test') {
        if (!preferences.enabled) return send(res, 409, { error: 'search-is-disabled' })
        await embedded.ensureStarted()
        const response = await fetch(SEARCH_ENDPOINT + '/search?q=deepseek&format=json',
          { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error('searxng-http-' + response.status)
        const result = await response.json()
        if (!Array.isArray(result.results)) throw new Error('invalid-search-json')
        return send(res, 200, { results: result.results.length,
          healthy: result.results.length > 0 })
      }
      return send(res, 400, { error: 'invalid-action' })
    } catch (error) {
      warn(error)
      if (!res.writableEnded) send(res, error?.message === 'request-too-large' ? 413 : 400,
        { error: String(error?.message || 'operation-failed').slice(0, 180) })
    } finally { release() }
  })
}
