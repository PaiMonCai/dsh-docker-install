/**
 * Official ctx.web seam; no DSH Core edits or custom model-facing tool.
 * Environment values describe the deployment, never contain a default paid key.
 */
import { SearchRouter } from './router.js'

export const name = 'dsh-docker-web-search'
export const inject = ['web']

export function apply(ctx) {
  const router = new SearchRouter({
    searxngURL: process.env.DSH_SEARCH_SEARXNG_URL || 'http://dsh-searxng:8080',
    braveEnabled: process.env.DSH_SEARCH_BRAVE_ENABLED === 'true',
    braveRef: 'BRAVE_SEARCH_API_KEY',
    resolveBraveKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials) return (await credentials.resolve('BRAVE_SEARCH_API_KEY'))?.value
      return process.env.BRAVE_SEARCH_API_KEY || undefined
    },
    timeoutMs: 11500,
    searxngTimeoutMs: 7000,
    braveTimeoutMs: 4000,
    cacheEnabled: process.env.DSH_SEARCH_CACHE_ENABLED !== 'false',
  })
  ctx.web.registerSearchProvider(router)
}
