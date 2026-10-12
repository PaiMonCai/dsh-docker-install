import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmbeddedSearxng, ensureSearxSettings, SEARCH_ENDPOINT, childEnvironment } from '../docker/plugins/dsh-web-search/embedded.js'
import { SearchSettings, validate, defaults } from '../docker/plugins/dsh-web-search/settings.js'
import { SearchRouter } from '../docker/plugins/dsh-web-search/router.js'

test('bundled search configuration is private, loopback-only and excludes Tor engines', async () => {
  const home = await mkdtemp(join(tmpdir(), 'embedded-dsh-searx-'))
  try {
    const first = await ensureSearxSettings(home)
    const text = await readFile(first, 'utf8')
    assert.match(text, /^use_default_settings:/)
    assert.match(text, /- ahmia\n\s+- torch/)
    assert.match(text, /limiter: false/)
    assert.match(text, /formats: \[html, json\]/)
    assert.match(text, /secret_key: "[a-f0-9]{64}"/)
    assert.equal(await ensureSearxSettings(home), first)
    assert.equal(await readFile(first, 'utf8'), text)
    assert.equal(SEARCH_ENDPOINT, 'http://127.0.0.1:18788')
  } finally { await rm(home, { recursive: true, force: true }) }
})
test('bundled search rejects symlink settings to prevent credential overwrite', async () => {
  const home = await mkdtemp(join(tmpdir(), 'embedded-dsh-path-'))
  try {
    const target = join(home, 'target')
    await symlink(target, join(home, 'web-search'))
    await assert.rejects(ensureSearxSettings(home), /Unsafe/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
test('Web preferences validate explicit booleans and bounded paid fallback limits', () => {
  assert.equal(defaults({}).braveEnabled, false)
  const valid = { enabled: true, braveEnabled: false, cacheEnabled: true, braveDailyLimit: 0 }
  assert.deepEqual(validate(valid), valid)
  assert.throws(() => validate({ ...valid, braveDailyLimit: 10001 }), /invalid/)
  assert.throws(() => validate({ ...valid, injected: 'x' }), /invalid/)
  assert.throws(() => validate({ ...valid, cacheEnabled: 'false' }), /invalid/)
})
test('Web preferences persist across restarts without credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'embedded-dsh-pref-'))
  try {
    const store = new SearchSettings(home)
    const data = { enabled: false, braveEnabled: true, braveDailyLimit: 3, cacheEnabled: false }
    await store.save(data)
    assert.deepEqual(await new SearchSettings(home).load(), data)
    assert.doesNotMatch(await readFile(store.path, 'utf8'), /API_KEY|password|secret/)
  } finally { await rm(home, { recursive: true, force: true }) }
})
test('disabled router never launches a child process or consumes paid API', async () => {
  let started = 0
  const router = new SearchRouter({ enabled: false, searxngURL: SEARCH_ENDPOINT,
    prepare: async () => { started++ }, http: () => { throw Error('called') } })
  await assert.rejects(router.search({ query: 'hello' }), { code: 'DSH_SEARCH_DISABLED' })
  assert.equal(started, 0)
})
test('router starts local process on demand, and propagates startup errors', async () => {
  let started = 0
  const router = new SearchRouter({ searxngURL: SEARCH_ENDPOINT,
    prepare: async () => { started++ },
    http: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({ results: [{ url: 'https://example.com', title: 'Found' }] }) }) })
  assert.equal((await router.search({ query: 'deepseek' })).sources.length, 1)
  assert.equal(started, 1)
  const broken = new SearchRouter({ searxngURL: SEARCH_ENDPOINT, prepare: async () => {
    throw new Error('launch error')
  }, http: () => { throw Error('should never search') } })
  await assert.rejects(broken.search({ query: 'deepseek' }), { code: 'DSH_SEARCH_SEARXNG_UNAVAILABLE' })
})
test('manager never spawns when a healthy local service already exists', async () => {
  let calls = 0
  const manager = new EmbeddedSearxng({ health: async () => true,
    spawnProcess: () => { calls++; throw Error('unexpected launch') } })
  await manager.ensureStarted()
  assert.equal(calls, 0)
})

test('child inherits DSH network proxy but never receives provider keys or Docker credentials', () => {
  const env = childEnvironment('/tmp/private/settings.yml', {
    HTTP_PROXY: 'http://dsh-proxy:7890',
    HTTPS_PROXY: 'http://dsh-proxy:7890',
    NO_PROXY: 'dsh-proxy',
    DEEPSEEK_API_KEY: 'secret-do-not-forward',
    BRAVE_SEARCH_API_KEY: 'paid-secret',
    DOCKER_HOST: 'unix:///var/run/docker.sock',
  })
  assert.equal(env.HTTP_PROXY, 'http://dsh-proxy:7890')
  assert.match(env.NO_PROXY, /127.0.0.1/)
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.equal(env.BRAVE_SEARCH_API_KEY, undefined)
  assert.equal(env.DOCKER_HOST, undefined)
  assert.equal(env.SEARXNG_SETTINGS_PATH, '/tmp/private/settings.yml')
})
