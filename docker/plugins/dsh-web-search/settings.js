/** Persistent nonsecret per-install search preferences. Browser never receives the API key. */
import { mkdir, readFile, lstat, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function defaults(env = process.env) {
  const limit = Number(env.DSH_SEARCH_BRAVE_DAILY_LIMIT)
  return {
    provider: 'searxng', // Explicit plugin opt-in retains the historical SearXNG default.
    enabled: true,
    braveEnabled: env.DSH_SEARCH_BRAVE_ENABLED === 'true',
    braveDailyLimit: Number.isInteger(limit) && limit >= 0 && limit <= 10000 ? limit : 50,
    cacheEnabled: env.DSH_SEARCH_CACHE_ENABLED !== 'false',
  }
}
// Preserve existing four-field settings.json files when upgrading. New saves use
// the five-field schema; official mode deliberately does not disable the plugin.
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid-search-settings')
  const keys = Object.keys(input)
  if (keys.some(key => !['provider', 'enabled', 'braveEnabled', 'braveDailyLimit', 'cacheEnabled'].includes(key))
    || (keys.length !== 4 && keys.length !== 5)
    || (input.provider !== undefined && !['official', 'searxng'].includes(input.provider))
    || typeof input.enabled !== 'boolean'
    || typeof input.braveEnabled !== 'boolean'
    || typeof input.cacheEnabled !== 'boolean'
    || !Number.isInteger(input.braveDailyLimit) || input.braveDailyLimit < 0
    || input.braveDailyLimit > 10000) throw new Error('invalid-search-settings')
  return { provider: input.provider ?? 'searxng', enabled: input.enabled,
    braveEnabled: input.braveEnabled, braveDailyLimit: input.braveDailyLimit,
    cacheEnabled: input.cacheEnabled }
}

export function selectedProvider(settings) {
  return settings.enabled && settings.provider === 'searxng' ? 'searxng' : 'official'
}

export class SearchSettings {
  constructor(home = process.env.DSH_HOME || '/root/.dsh') {
    this.dir = join(home, 'web-search')
    this.path = join(this.dir, 'settings.json')
  }
  async guard() {
    for (const path of [this.dir, this.path]) {
      const st = await lstat(path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
      if (st && (st.isSymbolicLink() || (path === this.dir ? !st.isDirectory() : !st.isFile())))
        throw new Error('unsafe-search-settings-path')
    }
  }
  async load(fallback = defaults()) {
    await this.guard()
    const stat = await lstat(this.path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
    if (!stat) return fallback
    if (stat.size > 8192) throw new Error('oversized-search-settings')
    return validate(JSON.parse(await readFile(this.path, 'utf8')))
  }
  async save(data) {
    const normalized = validate(data)
    await this.guard()
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const tmp = join(this.dir, '.settings-' + randomUUID() + '.json')
    try {
      await writeFile(tmp, JSON.stringify(normalized) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(tmp, this.path)
    } finally { await rm(tmp, { force: true }).catch(() => {}) }
    return normalized
  }
}
