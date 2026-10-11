import { SearchFailure } from './searxng.js'
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
export async function searchBrave(request, { key, signal, http = fetch }) {
  if (!key) throw new SearchFailure('Brave credential missing', 'DSH_SEARCH_BRAVE_CREDENTIAL_MISSING')
  const url = new URL(ENDPOINT)
  url.searchParams.set('q', request.query)
  url.searchParams.set('count', String(Math.min(20, Math.max(1, request.maxResults || 8))))
  let response
  try {
    response = await http(url, { signal, redirect: 'error', headers: {
      accept: 'application/json', 'x-subscription-token': key,
    } })
  } catch { throw new SearchFailure('Brave connection failed', 'DSH_SEARCH_BRAVE_UNAVAILABLE') }
  if (!response.ok) {
    const code = response.status === 429 ? 'DSH_SEARCH_BRAVE_RATE_LIMITED' : 'DSH_SEARCH_BRAVE_HTTP'
    throw new SearchFailure('Brave search HTTP ' + response.status, code)
  }
  let body
  try { body = await response.json() }
  catch { throw new SearchFailure('Invalid Brave JSON response', 'DSH_SEARCH_BRAVE_BAD_JSON') }
  if (!Array.isArray(body?.web?.results)) {
    throw new SearchFailure('Brave did not return web results', 'DSH_SEARCH_BRAVE_BAD_JSON')
  }
  return { sources: body.web.results.map(row => ({
    url: row.url, title: row.title, snippet: row.description,
    ...(row.page_age && /^\d{4}-\d\d-\d\d/.test(row.page_age) ? { publishedAt: row.page_age } : {}),
  })) }
}
