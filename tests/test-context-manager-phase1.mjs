import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectPlugins, inspectCompactionService, makeProbe, AGENT_PRESET_PACKAGE } from '../docker/plugins/dsh-context-manager/core.mjs'
import { apply, name, ENDPOINT } from '../docker/plugins/dsh-context-manager/index.js'

const text = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('read-only plugin tree inspector recognizes nested DSH, external and disabled entries', () => {
  const rows = [
    { group: true, config: [
      { name: '@deepseek-ai/dsh-compaction-basic', config: { auto: true } },
      { name: '@deepseek-ai/dsh-command-compact', disabled: true },
      { name: '@deepseek-ai/dsh-compaction-tool-result-pruner' },
    ] },
    { name: 'bili-native' }, { name: 'billion-context', disabled: true },
  ]
  const original = structuredClone(rows)
  const result = inspectPlugins(rows)
  assert.deepEqual(result.basic, { total: 1, enabled: 1, auto: 1 })
  assert.deepEqual(result.manual, { total: 1, enabled: 0 })
  assert.deepEqual(result.pruner, { total: 1, enabled: 1 })
  assert.deepEqual(result.externalBili, { total: 2, enabled: 1 })
  assert.deepEqual(rows, original)
})

test('malformed and cyclic structures cannot hang probe', () => {
  const nested = []
  nested.push({ group: true, config: nested })
  assert.equal(inspectPlugins(nested).basic.total, 0)
  assert.equal(inspectPlugins([null, 1, 'x', {}, { name: '@deepseek-ai/dsh-compaction-basic', disabled: true }]).basic.enabled, 0)
})

test('preset observation is scoped and does not keep prompts or raw config', () => {
  const probe = makeProbe(() => 123)
  const secret = 'SECRET-NOT-IN-DIAGNOSTICS'
  const config = { id: 'preset-standard', systemPrompt: secret,
    plugins: [{ name: '@deepseek-ai/dsh-compaction-basic', config: { auto: true, prompt: secret } }] }
  probe.observeConfig({ options: { name: 'unrelated' } }, config)
  assert.equal(probe.snapshot({}).hooks.presetConfigsObserved, 0)
  probe.observeConfig({ options: { name: AGENT_PRESET_PACKAGE } }, config)
  const snapshot = probe.snapshot({})
  assert.equal(snapshot.hooks.presetConfigsObserved, 1)
  assert.equal(snapshot.presets[0].id, 'preset-standard')
  assert.equal(snapshot.presets[0].plugins.basic.auto, 1)
  assert.ok(!JSON.stringify(snapshot).includes(secret))
  assert.equal(snapshot.ownership, 'unverified')
  assert.equal(snapshot.mutatesSessions, false)
  assert.ok(snapshot.warnings.some(w => w.includes('host-only')))
})

test('bounded snapshots retain latest 12 and count only compaction event types', () => {
  const probe = makeProbe(() => 42)
  for (let i = 0; i < 20; i++) {
    probe.observeConfig({ options: { name: AGENT_PRESET_PACKAGE } },
      { id: 'preset-' + i, plugins: [] })
  }
  const leaked = { content: 'PRIVATE', id: 'private-session-id' }
  probe.observeEvent(leaked, { type: 'assistant/message', data: { text: 'PRIVATE' } })
  probe.observeEvent(leaked, { type: 'compaction/summary', data: { summary: 'PRIVATE' } })
  const snapshot = probe.snapshot({})
  assert.equal(snapshot.presets.length, 12)
  assert.equal(snapshot.presets[0].id, 'preset-8')
  assert.equal(snapshot.hooks.sessionEventsObserved, 1)
  assert.equal(snapshot.events['compaction/summary'], 1)
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'))
  assert.ok(!JSON.stringify(snapshot).includes('private-session-id'))
})

test('host-only service probe never claims a preset-bound service', () => {
  assert.deepEqual(inspectCompactionService({}), {
    available: false, scope: 'host-only', reason: 'not-visible-in-host-context',
  })
  const result = inspectCompactionService({ get: () => ({
    constructor: { name: 'BasicCompactionEngine' },
    compactIfNeeded() {}, compactNow() {}, compactRegion() {},
  }) })
  assert.equal(result.available, true)
  assert.equal(result.implementation, 'BasicCompactionEngine')
  assert.equal(result.compactNow, true)
  assert.equal(result.scope, 'host-only')
})

test('cordis adapter passes through config and only exposes status RPC', async () => {
  const listeners = new Map()
  const methods = new Map()
  const operations = []
  const ctx = {
    logger: { warn: msg => { throw Error(msg) } },
    get: () => undefined,
    on(event, cb, options) { listeners.set(event, cb); operations.push(['on', event, options]) },
    inject(deps, callback) {
      assert.deepEqual(deps, ['connection'])
      callback({ connection: { rpc: { handle(path, handler) { methods.set(path, handler) } } } })
    },
  }
  assert.equal(name, 'dsh-docker-context-manager')
  apply(ctx)
  assert.equal(operations.some(x => x[0] === 'on' && x[1] === 'agent/pre-step'), false)
  assert.equal(operations.some(x => x[1] === 'internal/config' && x[2]?.global === true), true)
  const input = { id: 'custom', plugins: [{ name: '@deepseek-ai/dsh-compaction-basic', config: { auto: true } }] }
  const handler = listeners.get('internal/config')
  const resolved = handler.call({ entry: { options: { name: AGENT_PRESET_PACKAGE } } }, {}, () => input)
  assert.strictEqual(resolved, input)
  listeners.get('session/event')({}, { type: 'compaction/start', data: { original: 'sensitive' } })
  const rpc = methods.get(ENDPOINT)
  const status = await rpc('status', {})
  assert.equal(status.ok, true)
  assert.equal(status.value.presets.length, 1)
  assert.equal(status.value.events['compaction/start'], 1)
  assert.equal(status.value.engine, 'not-installed')
  assert.deepEqual(await rpc('save', {}), {
    ok: false, error: { code: 'invalid_request', message: 'phase 1 is read-only' },
  })
  assert.equal((await rpc('status', { dangerous: true })).ok, false)
})

test('launcher opt-in, image COPY and workflow tests are wired for Standard and Reverse', () => {
  assert.match(text('docker/entrypoint.sh'), /dsh-context-manager\/cordis\.patch\.yml" "\$\{DSH_CONTEXT_MANAGER_PROBE:-false\}"/)
  assert.match(text('Dockerfile'), /COPY docker\/plugins\/dsh-context-manager\//)
  assert.match(text('Dockerfile'), /dsh-context-manager\/cordis\.patch\.yml --dump-config/)
  assert.match(text('docker-compose.yml'), /DSH_CONTEXT_MANAGER_PROBE:/)
  assert.match(text('docker-compose.reverse.yml'), /DSH_CONTEXT_MANAGER_PROBE:/)
  assert.match(text('.github/workflows/build.yml'), /node --test tests\/test-context-manager-phase1\.mjs/)
  assert.match(text('.github/workflows/build-reverse.yml'), /node --test tests\/test-context-manager-phase1\.mjs/)
})

test('read-only DSH client registers its own settings slot without mutating configuration', () => {
  const source = text('docker/plugins/dsh-context-manager/client.js')
  const calls = []
  let factory
  const loader = { load(entry) { factory = entry.factory } }
  // No actual browser APIs are needed to validate the native slot contract.
  const run = new Function('window', source)
  run({ __ModuleLoader__: loader })
  const plugin = factory(() => ({ createElement: (...parts) => ({ parts }), useEffect() {}, useState: v => [v, () => {}] }))
  plugin.apply({ connection: { rpc: { call: (...args) => calls.push(args) } },
    slots: { inject(name, fn) {
      assert.equal(name, 'settings.section')
      fn()
    }, register(metadata) {
      assert.equal(metadata.id, 'dsh-docker-context-manager')
      metadata.inject().call('status', {})
      return () => {}
    } } })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['/dsh-docker-context-manager', 'status', {}])
})
