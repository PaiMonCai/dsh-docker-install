import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaults, normalizeSettings } from '../docker/plugins/dsh-context-manager/policy.mjs'
import { configureNativePlugin, nativeBootSettings, adaptNativePreset, nativeOrderingPatches,
  externalContextPluginPresent, nativePluginStatus } from '../docker/plugins/dsh-context-manager/native-plugin.mjs'
import { BASIC, MANUAL, TIERED, ACP_TOOLS, GATE } from '../docker/plugins/dsh-context-manager/takeover.mjs'
import { makeNativeTieredEngine } from '../docker/plugins/dsh-context-manager/tiered-backend.mjs'
import {apply,ENDPOINT} from '../docker/plugins/dsh-context-manager/index.js'

function enabled() {
  const saved = defaults()
  saved.nativePlugin.enabled = true
  saved.engine = 'tiered'
  return saved
}
function preset(id = 'standard') {
  return { id, name: 'Original preset', plugins: [{ id: 'compaction', group: true, name: 'cordis:group', config: [
    { id: 'basic', name: BASIC, config: { maxTokens: 7000, retainTokens: 1200, modelPolicies: [
      { provider: 'other', model: 'original', retainTokens: 1000 },
    ] } },
    { id: 'manual', name: MANUAL },
  ] }, { id: 'native-tool', name: 'native-tools', disabled: { __js: 'platform === windows' }, config: { keep: 'original' } }] }
}

test('old saved tiered intentions do not activate the native plugin', () => {
  const old = enabled(); delete old.nativePlugin
  const migrated = normalizeSettings(old)
  assert.equal(migrated.nativePlugin.enabled, false)
  assert.equal(configureNativePlugin(migrated, {}), null)
  assert.equal(adaptNativePreset(preset(), migrated).changed, false)
})

test('native switch needs no lab flags, is immutable until restart, and supports emergency disable', () => {
  const saved = enabled()
  configureNativePlugin(saved, {})
  saved.nativePlugin.enabled = false
  assert.equal(nativeBootSettings().nativePlugin.enabled, true)
  const copy = nativeBootSettings(); copy.engine = 'off'
  assert.equal(nativeBootSettings().engine, 'tiered')
  assert.equal(configureNativePlugin(enabled(), { DSH_CONTEXT_MANAGER_NATIVE_ACTIVE: '0' }), null)
  assert.throws(() => configureNativePlugin(enabled(), { DSH_CONTEXT_MANAGER_TIERED_ACTIVE: '1' }), /cannot be combined/)
  assert.equal(nativeBootSettings(), null)
})

test('eligible presets retain their complete original composition and native route settings', () => {
  for (const id of ['standard', 'reverse-engineering', 'research']) {
    const original = preset(id), before = structuredClone(original)
    const saved = enabled()
    saved.modelPolicies = [{ provider: 'other', model: 'original', basic: { retainRatio: .1 } }]
    const adapted = adaptNativePreset(original, saved)
    assert.equal(adapted.changed, true, adapted.reason)
    assert.deepEqual(original, before)
    const rows = adapted.config.plugins[0].config
    assert.equal(rows.filter(row => row.name === TIERED).length, 1)
    assert.equal(rows.filter(row => row.name === ACP_TOOLS).length, 1)
    assert.deepEqual(rows.find(row => row.name === MANUAL), original.plugins[0].config[1])
    assert.equal(rows[0].config.maxTokens, 7000)
    assert.equal(rows[0].config.retainTokens, undefined)
    assert.deepEqual(rows[0].config.modelPolicies, [{ provider: 'other', model: 'original', retainRatio: .1 }])
    assert.deepEqual(adapted.config.plugins[1], original.plugins[1])
  }
})

test('incompatible, conditional and competing owners preserve the exact original config', () => {
  for (const mutate of [
    row => row.plugins[0].config.push({ name: BASIC }),
    row => row.plugins.push({ name: 'billion-context' }),
    row => row.plugins[0].config.splice(1, 1),
    row => { row.plugins[0].config[0].disabled = { __js: 'some_condition' } },
    row => row.plugins.push({ id: 'native-acp-tools', name: 'other' }),
    row => row.plugins.push({ name: ACP_TOOLS }),
    row => { row.plugins = [] },
  ]) {
    const original = preset(); mutate(original)
    const result = adaptNativePreset(original, enabled())
    assert.equal(result.changed, false)
    assert.equal(result.config, original)
    assert.ok(result.reason)
  }
})

test('Agent native policy overrides and mixed model engines are never silently applied', () => {
  const saved = enabled()
  saved.agentPolicies = [{ agentId: 'standard', engine: 'basic' }]
  assert.equal(adaptNativePreset(preset(), saved).reason, 'native-policy-selected')
  saved.agentPolicies = []
  saved.modelPolicies = [{ provider: 'p', model: 'm', engine: 'off' }]
  assert.equal(adaptNativePreset(preset(), saved).reason, 'mixed-model-modes-unsupported')
  saved.nativePlugin.enabled = false
  assert.equal(adaptNativePreset(preset(), saved).reason, 'disabled')
})

test('native original retrieval cannot be disabled while creating new compressed records', () => {
  const saved = enabled(); saved.tiered.retrievalEnabled = false
  assert.throws(() => normalizeSettings(saved), /requires original retrieval/)
})

test('launcher gates preserve original injects and nested group paths', () => {
  const tree = [{ id: 'outer', name: 'cordis:group', group: true, config: [
    { id: 'preset-standard', name: '@deepseek-ai/dsh-agent-preset', inject: ['existing'], config: {} },
  ] }, { id: 'reverse-preset', name: '@deepseek-ai/dsh-agent-preset' },
  { id: 'unrelated', name: 'other', inject: ['keep'] }]
  const before = structuredClone(tree)
  assert.deepEqual(nativeOrderingPatches(tree), [
    { id: 'outer', config: [{ id: 'preset-standard', inject: ['existing', GATE] }] },
    { id: 'reverse-preset', inject: [GATE] },
  ])
  assert.deepEqual(tree, before)
  tree[1].inject = { some: 'unsupported' }
  assert.throws(() => nativeOrderingPatches(tree), /unsupported preset injection/)
})

test('known external plugin manifests are detected without reading credentials', t => {
  const home = mkdtempSync(join(tmpdir(), 'context-native-manifest-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.equal(externalContextPluginPresent(home, {}), false)
  const dir = join(home, 'profiles', 'custom')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'billion-context': '*' } }))
  assert.equal(externalContextPluginPresent(home, {}), true)
})

test('read-only status remains available when persisted settings cannot be read', async t => {
  const home = mkdtempSync(join(tmpdir(), 'context-native-invalid-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old
    rmSync(home, { recursive: true, force: true })
  })
  mkdirSync(join(home, 'dsh-docker', 'context-manager'), { recursive: true })
  writeFileSync(join(home, 'dsh-docker', 'context-manager', 'settings.json'), 'invalid JSON')
  let rpc
  apply({ logger: { warn() {} }, on() {}, get() {}, inject(_names, run) {
    run({ connection: { rpc: { handle(path, handler) { assert.equal(path,ENDPOINT);rpc=handler } } } })
  } })
  const status = await rpc('status', {})
  assert.equal(status.ok, true)
  assert.equal(status.value.nativePlugin.bootEnabled, false)
  assert.equal(status.value.nativePlugin.reason, 'startup-incompatible')
  assert.equal((await rpc('settings', {})).ok, false)
})

test('runtime distinguishes configured, mounted, skipped and saved pending restart', () => {
  const saved = enabled()
  const metric = active => ({ active, configured: active, conditional: 0 })
  const inventory = { available: true, presets: [{ id: 'standard',
    tiered: metric(1), basic: metric(0), external: metric(0), manual: metric(1), acp: metric(1) }] }
  const composed = new Map([['standard', { preset: 'standard', changed: true }],
    ['research', { preset: 'research', changed: false, reason: 'unsupported-compaction-ownership' }]])
  const status = nativePluginStatus(saved, saved, composed, inventory)
  assert.equal(status.restartPending, false)
  assert.equal(status.presets[0].state, 'active')
  assert.equal(status.presets[1].state, 'native-unchanged')
  assert.equal(status.productionApproved, false)
  saved.nativePlugin.enabled = false
  assert.equal(nativePluginStatus(saved, enabled(), composed, inventory).restartPending, true)
  inventory.presets[0].acp.active = 0
  assert.equal(nativePluginStatus(enabled(), enabled(), composed, inventory).presets[0].state, 'awaiting-mount')
})

test('native enhancement failure falls back to the original summarizer; cancellation still aborts', async () => {
  configureNativePlugin(enabled(), {})
  let originalCalls = 0
  class Basic {
    constructor(ctx, config) { this.ctx = ctx; this.config = config }
    summarize() { originalCalls++; return { summary: [{ type: 'text', text: 'native original summary' }] } }
  }
  class Blocks { push() {} blocks() { return [{ type: 'text', text: 'invalid' }] } }
  const Engine = makeNativeTieredEngine(Basic, { BlockAssembler: Blocks })
  const engine = new Engine({ llm: { async *stream() {} } }, {})
  const agent = { options: { provider: 'original', model: 'original' }, session: { toolHistory: () => [] } }
  assert.equal((await engine.summarize({ messages: [] }, agent)).summary[0].text, 'native original summary')
  assert.equal(originalCalls, 1)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(engine.summarize({ messages: [] }, agent, controller.signal), /abort/i)
  assert.equal(originalCalls, 1)
  configureNativePlugin(defaults(), {})
})
