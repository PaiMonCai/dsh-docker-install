export class SearchFailure extends Error {
  constructor(message, code, fallbackAllowed = false) {
    super(message)
    this.name = 'SearchFailure'
    this.code = code
    this.fallbackAllowed = fallbackAllowed
  }
}
export async function searchSearxng(request, { baseURL, signal, http = fetch }) {
  let url
  try {
    url = new URL('/search', baseURL)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol')
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
  } catch { throw new SearchFailure('Invalid SearXNG endpoint', 'DSH_SEARCH_BAD_ENDPOINT') }
  let response
  try {
    response = await http(url, { method: 'GET', signal, redirect: 'error',
      headers: { accept: 'application/json' } })
  } catch {
    throw new SearchFailure('SearXNG connection failed or timed out', 'DSH_SEARCH_SEARXNG_UNAVAILABLE', true)
  }
  if (!response.ok) {
    throw new SearchFailure('SearXNG HTTP ' + response.status, 'DSH_SEARCH_SEARXNG_HTTP',
      response.status === 429 || response.status >= 500)
  }
  let body
  try {
    if (!(response.headers?.get('content-type') || '').includes('json')) {
      throw new Error('expected JSON')
    }
    body = await response.json()
    if (!Array.isArray(body?.results)) throw new Error('missing results')
  } catch {
    throw new SearchFailure('SearXNG must enable JSON search output', 'DSH_SEARCH_SEARXNG_BAD_JSON', true)
  }
  return { sources: body.results.map(row => ({
    url: row.url, title: row.title, snippet: row.content,
    ...(row.publishedDate || row.published_at ? { publishedAt: row.publishedDate || row.published_at } : {}),
  })) }
}
