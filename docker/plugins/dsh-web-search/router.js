import { SearchFailure, searchSearxng } from './providers/searxng.js'
import { searchBrave } from './providers/brave.js'
import { SearchCache } from './cache.js'

const DEFAULT_TIMEOUT = 11500
function bool(v) { return v === true }
function requireBounded(value, limit, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new SearchFailure(name + ' must be a nonempty bounded string', 'DSH_SEARCH_INVALID_REQUEST')
  }
}
function abortCode(signal) {
  return signal?.aborted ? 'WEB_ABORTED' : 'DSH_SEARCH_DEADLINE_EXCEEDED'
}
export function timeBound(signal, ms) {
  const controller = new AbortController()
  if (signal?.aborted) controller.abort(signal.reason)
  const onAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('search deadline reached')), Math.max(1, ms))
  return { signal: controller.signal, close() { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort) } }
}
function normalizeResult(result, maxResults) {
  const sources = []
  const seen = new Set()
  for (const source of result.sources || []) {
    try {
      const url = new URL(source.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
      url.hash = ''
      const key = url.toString()
      if (seen.has(key)) continue
      seen.add(key)
      sources.push({ url: key, ...(source.title ? { title: String(source.title).slice(0, 400) } : {}),
        ...(source.snippet ? { snippet: String(source.snippet).slice(0, 1200) } : {}),
        ...(source.publishedAt && Number.isFinite(Date.parse(source.publishedAt))
          ? { publishedAt: new Date(source.publishedAt).toISOString() } : {}) })
    } catch { /* Skip malformed third-party URLs. */ }
  }
  const cap = Number.isInteger(maxResults) && maxResults > 0 ? maxResults : 8
  return { sources: sources.slice(0, cap), truncated: sources.length > cap }
}
export class SearchRouter {
  id = 'dsh-docker-search'
  constructor(options = {}) {
    this.options = {
      searxngURL: options.searxngURL,
      enabled: options.enabled !== false,
      prepare: options.prepare || (async () => {}),
      braveEnabled: bool(options.braveEnabled),
      resolveBraveKey: options.resolveBraveKey || (async () => undefined),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
      searxngTimeoutMs: options.searxngTimeoutMs ?? 7000,
      braveTimeoutMs: options.braveTimeoutMs ?? 4000,
      cacheEnabled: options.cacheEnabled !== false,
      http: options.http || fetch,
      braveBudget: options.braveBudget || { reserve: async () => true },
    }
    this.cache = new SearchCache({ maxEntries: 500, maxBytes: 32 * 1024 * 1024 })
  }
  available() {
    try { return this.options.enabled && ['http:', 'https:'].includes(new URL(this.options.searxngURL).protocol) } catch { return false }
  }
  async search(request, signal) {
    requireBounded(request?.query, 2048, 'query')
    if (signal?.aborted) throw new SearchFailure('Search cancelled', 'WEB_ABORTED')
    const opts = this.options
    if (!opts.enabled) throw new SearchFailure('Embedded web search is disabled', 'DSH_SEARCH_DISABLED')
    const cacheKey = JSON.stringify([request.query, request.maxResults || 8, opts.searxngURL,
      opts.braveEnabled, 'v1'])
    if (opts.cacheEnabled) {
      const hit = this.cache.get(cacheKey)
      if (hit) return hit
    }
    const deadline = Date.now() + opts.timeoutMs
    const outer = timeBound(signal, opts.timeoutMs)
    let result, source = 'searxng'
    try {
      try {
        const primary = timeBound(outer.signal, Math.min(opts.searxngTimeoutMs, deadline - Date.now()))
        try {
          try { await opts.prepare() } catch (error) {
            throw new SearchFailure('Embedded SearXNG is unavailable: ' + error.message,
              'DSH_SEARCH_SEARXNG_UNAVAILABLE', true)
          }
          result = await searchSearxng(request, { baseURL: opts.searxngURL, signal: primary.signal, http: opts.http })
        } catch (error) {
          if (signal?.aborted) throw new SearchFailure('Search cancelled', 'WEB_ABORTED')
          if (!error?.fallbackAllowed || !opts.braveEnabled) throw error
          if (Date.now() >= deadline - 500) throw new SearchFailure('Search timed out', abortCode(signal))
          const key = await opts.resolveBraveKey()
          if (!key) throw new SearchFailure('Brave fallback enabled but BRAVE_SEARCH_API_KEY is missing',
            'DSH_SEARCH_BRAVE_CREDENTIAL_MISSING')
          if (!(await opts.braveBudget.reserve())) {
            throw new SearchFailure('Daily Brave fallback budget exhausted', 'DSH_SEARCH_BRAVE_BUDGET_EXHAUSTED')
          }
          const remaining = deadline - Date.now() - 200
          const secondary = timeBound(outer.signal, Math.min(opts.braveTimeoutMs, remaining))
          try {
            result = await searchBrave(request, { key, signal: secondary.signal, http: opts.http })
            source = 'brave'
          } finally { secondary.close() }
        } finally { primary.close() }
      } catch (error) {
        if (signal?.aborted) throw new SearchFailure('Search cancelled', 'WEB_ABORTED')
        if (outer.signal.aborted) throw new SearchFailure('Search timed out', 'DSH_SEARCH_DEADLINE_EXCEEDED')
        throw error
      }
      const normalized = normalizeResult(result, request.maxResults)
      if (opts.cacheEnabled && normalized.sources.length) {
        this.cache.set(cacheKey, normalized, source === 'brave' ? 120000 : 900000)
      }
      return normalized
    } finally { outer.close() }
  }
}
