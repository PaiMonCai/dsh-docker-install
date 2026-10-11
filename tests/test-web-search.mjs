import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SearchRouter } from '../docker/plugins/dsh-web-search/router.js'
import { SearchCache } from '../docker/plugins/dsh-web-search/cache.js'

function reply(body, status=200, ct='application/json') {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: () => ct }, json: async () => body }
}
const good = () => reply({ results: [{ url: 'https://example.com/a', title: 'Example', content: 'Hello' }] })
test('SearXNG success never calls Brave', async () => {
  let brave=0
  const router = new SearchRouter({ searxngURL: 'http://searxng:8080', braveEnabled: true,
    resolveBraveKey: async () => 'test',
    http: async url => { if (String(url).includes('brave')) brave++; return good() } })
  assert.equal((await router.search({ query: 'test' })).sources.length, 1)
  assert.equal(brave,0)
})
test('cache avoids repeated outbound queries and returns an immutable clone', async () => {
  let calls=0
  const router=new SearchRouter({ searxngURL: 'http://searxng:8080',
    http: async () => {calls++;return good()} })
  const result=await router.search({query:'same'})
  result.sources[0].title='modified'
  assert.equal((await router.search({query:'same'})).sources[0].title,'Example')
  assert.equal(calls,1)
})
test('SearXNG 503 falls back with explicitly authorized Brave', async () => {
  const urls=[]
  const router=new SearchRouter({searxngURL:'http://searxng:8080',braveEnabled:true,
    resolveBraveKey:async()=> 'secret',
    http:async (url,init) => {
      urls.push(String(url))
      if(String(url).includes('searxng')) return reply({},503)
      assert.equal(init.headers['x-subscription-token'],'secret')
      return reply({web:{results:[{url:'https://brave.com/a',title:'Result',description:'Snippet'}]}})
    }})
  const results=await router.search({query:'fallback'})
  assert.equal(results.sources[0].url,'https://brave.com/a')
  assert.equal(urls.length,2)
})
test('no paid fallback when disabled', async () => {
  let requests=0
  const router=new SearchRouter({searxngURL:'http://searxng:8080',
    http:async()=>{requests++;return reply({},503)}})
  await assert.rejects(router.search({query:'test'}),{code:'DSH_SEARCH_SEARXNG_HTTP'})
  assert.equal(requests,1)
})
test('missing Brave key never sends billed request', async () => {
  let requests=0
  const router=new SearchRouter({searxngURL:'http://searxng:8080',braveEnabled:true,
    resolveBraveKey:async()=>undefined,
    http:async()=>{requests++;return reply({},503)}})
  await assert.rejects(router.search({query:'test'}),{code:'DSH_SEARCH_BRAVE_CREDENTIAL_MISSING'})
  assert.equal(requests,1)
})
test('valid empty results do not call Brave', async () => {
  let requests=0
  const router=new SearchRouter({searxngURL:'http://searxng:8080',braveEnabled:true,
    http:async()=>{requests++;return reply({results:[]})}})
  assert.equal((await router.search({query:'nothing'})).sources.length,0)
  assert.equal(requests,1)
})
test('HTML response is rejected with actionable code', async () => {
  const router=new SearchRouter({searxngURL:'http://searxng:8080',
    http:async()=>reply(null,200,'text/html')})
  await assert.rejects(router.search({query:'test'}),{code:'DSH_SEARCH_SEARXNG_BAD_JSON'})
})
test('abort prevents network call', async () => {
  const controller=new AbortController();controller.abort()
  const router=new SearchRouter({searxngURL:'http://searxng:8080',
    http:async()=>{throw new Error('must not call')}})
  await assert.rejects(router.search({query:'cancelled'},controller.signal),{code:'WEB_ABORTED'})
})
test('LRU expires and evicts entries',()=> {
  const cache=new SearchCache({maxEntries:1,maxBytes:10000})
  cache.set('a',{x:1},1000);cache.set('b',{x:2},1000)
  assert.equal(cache.get('a'),undefined)
  assert.deepEqual(cache.get('b'),{x:2})
})
