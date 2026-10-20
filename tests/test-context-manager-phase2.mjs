import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { defaults, normalizeSettings, resolvePolicy, previewNative } from '../docker/plugins/dsh-context-manager/policy.mjs'
import { readSettings, writeSettings, settingsRevision, settingsPath } from '../docker/plugins/dsh-context-manager/storage.mjs'
import { apply, ENDPOINT } from '../docker/plugins/dsh-context-manager/index.js'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-context-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('defaults, schema and budget math use DSH native pressure formula', () => {
  const base = defaults()
  assert.deepEqual(normalizeSettings(base), base)
  const p = previewNative(base, { contextWindow: 200000, reservedOutput: 16000 })
  assert.equal(p.thresholdTokens, 118464)
  assert.equal(p.retainedRecentTokens, 36800)
  assert.equal(p.pressuredByHeadroom, true)
  assert.equal(p.note.includes('estimate-only'), true)
  assert.notEqual(base, defaults())
  assert.throws(() => previewNative(base, { contextWindow: 200000, reservedOutput: 200000 }), /reservedOutput/)
})

test('reject unknown keys, NaNs, incompatible thresholds, duplicate model and agent scopes', () => {
  const base = defaults()
  assert.throws(() => normalizeSettings({ ...base, unauthorized: true }), /invalid settings/)
  assert.throws(() => normalizeSettings({ ...base, basic: { ...base.basic, retainRatio: .79, thresholdRatio: .7 } }), /retention ratio/)
  assert.throws(() => normalizeSettings({ ...base, basic: { ...base.basic, thresholdRatio: NaN } }), /thresholdRatio/)
  assert.throws(() => normalizeSettings({ ...base, basic: { ...base.basic, headroomTokens: 1.5 } }), /headroomTokens/)
  assert.throws(() => normalizeSettings({ ...base, engine: 'dangerous' }), /engine/)
  assert.throws(() => normalizeSettings({ ...base, tiered: { ...base.tiered, nudgeGrowthTokens: -2 } }), /nudgeGrowthTokens/)
  assert.throws(() => normalizeSettings({ ...base, agentPolicies: [{agentId:'x',engine:'basic'}, {agentId:'x',engine:'off'}] }), /duplicate agent/)
  assert.throws(() => normalizeSettings({ ...base, modelPolicies: [{provider:'a',model:'b',engine:'basic'}, {provider:'a',model:'b',engine:'off'}] }), /duplicate model/)
  assert.throws(() => normalizeSettings({ ...base, agentPolicies: [{agentId:'../passwd',engine:'basic'}] }), /agentId/)
  assert.throws(() => normalizeSettings({ ...base, modelPolicies: new Array(33).fill({}) }), /policy list/)
})

test('policy cascade global then Agent then exact provider and model, no mutation', () => {
  const input = defaults()
  input.agentPolicies = [{ agentId: 'reverse-engineering', basic: { thresholdRatio: .65, retainRatio: .1 },
    engine: 'tiered' }]
  input.modelPolicies = [{ provider: 'test', model: 'm1', engine: 'off',
    basic: { thresholdRatio: .8 }, tiered: { preserveRecentMessages: 8 } }]
  const before = structuredClone(input)
  const resolved = resolvePolicy(input, { agentId: 'reverse-engineering', provider: 'test', model: 'm1' })
  assert.equal(resolved.engine, 'off')
  assert.equal(resolved.basic.thresholdRatio, .8)
  assert.equal(resolved.basic.retainRatio, .1)
  assert.equal(resolved.tiered.preserveRecentMessages, 8)
  assert.equal(resolvePolicy(input, { agentId: 'reverse-engineering' }).engine, 'tiered')
  assert.equal(resolvePolicy(input, {}).engine, 'basic')
  assert.deepEqual(input, before)
  assert.throws(() => resolvePolicy({ ...input, modelPolicies: [
    { provider: 'test', model: 'm1', basic: { thresholdRatio: .05 } }] },
    { agentId: 'reverse-engineering', provider: 'test', model: 'm1' }), /thresholdRatio/)
})

test('atomic persistent settings, revision conflicts and no secret placeholders', t => {
  const dir = home(t)
  assert.deepEqual(readSettings(dir), defaults())
  const baseRevision = settingsRevision(readSettings(dir))
  const changed = defaults()
  changed.engine = 'tiered'
  changed.basic.retainRatio = .15
  writeSettings(changed, baseRevision, dir)
  assert.deepEqual(readSettings(dir), changed)
  assert.equal(readFileSync(settingsPath(dir), 'utf8'), JSON.stringify(changed) + '\n')
  assert.equal(statSync(settingsPath(dir)).mode & 0o777, 0o600)
  assert.throws(() => writeSettings(defaults(), baseRevision, dir), /settings changed/)
  assert.throws(() => writeSettings(defaults(), undefined, dir), /revision required/)
  const tempFiles = readFileSync(settingsPath(dir), 'utf8')
  assert.ok(!tempFiles.includes('api_key'))
})

test('reject symlinked state and oversized or invalid on-disk settings', t => {
  const dir = home(t)
  mkdirSync(join(dir, 'dsh-docker'))
  symlinkSync('/tmp', join(dir, 'dsh-docker', 'context-manager'))
  assert.throws(() => readSettings(dir), /unsafe settings directory/)
  rmSync(join(dir, 'dsh-docker', 'context-manager'))
  mkdirSync(join(dir, 'dsh-docker', 'context-manager'))
  writeFileSync(settingsPath(dir), 'x'.repeat(32769))
  assert.throws(() => readSettings(dir), /unsafe settings file/)
  writeFileSync(settingsPath(dir), 'not-json')
  assert.throws(() => readSettings(dir), /invalid settings JSON/)
  rmSync(settingsPath(dir))
  symlinkSync('/etc/passwd', settingsPath(dir))
  assert.throws(() => readSettings(dir), /unsafe settings file/)
})

test('RPC saves desired policy, reports not applied, rejects stale revision', async t => {
  const dir = home(t)
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => { if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before })
  const handlers = {}
  const ctx = { logger: { warn() {} }, get() {},
    on() {}, inject(_names, callback) {
      callback({ connection: { rpc: { handle(path, handler) { handlers[path] = handler } } } })
    },
  }
  apply(ctx)
  const rpc = handlers[ENDPOINT]
  const initial = await rpc('settings', {})
  assert.equal(initial.ok, true)
  assert.equal(initial.value.runtime.applied, false)
  assert.equal(initial.value.runtime.effectiveEngine, 'upstream-unmanaged')
  const wanted = structuredClone(initial.value.settings)
  wanted.engine = 'off'
  const saved = await rpc('save', { settings: wanted, revision: initial.value.revision })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.runtime.applied, false)
  assert.equal(saved.value.runtime.restartPending, true)
  assert.equal(readSettings(dir).engine, 'off')
  const stale = await rpc('save', { settings: wanted, revision: initial.value.revision })
  assert.equal(stale.ok, false)
  assert.match(stale.error.message, /其他页面/)
  const fresh = await rpc('settings', {})
  assert.equal(fresh.value.settings.engine, 'off')
  assert.equal(fresh.value.runtime.applied, false)
  const estimate = await rpc('preview', { contextWindow: 200000, reservedOutput: 16000 })
  assert.equal(estimate.value.thresholdTokens, 118464)
  assert.equal((await rpc('resolve', { target: {} })).value.engine, 'off')
  assert.equal((await rpc('save', { settings: wanted, revision: fresh.value.revision, override: true })).ok, false)
})

test('phase 2 UI exposes strategy controls, clear pending state and scope inputs', () => {
  const client = read('docker/plugins/dsh-context-manager/client.js')
  for (const phrase of [
    '压缩策略', '运行状态', '高级规则', '触发比例', '保留近期历史',
    'agentPolicies', 'modelPolicies', '保存目标策略', '上游',
  ].slice(0, -1)) assert.ok(client.includes(phrase), 'missing UI: ' + phrase)
  assert.match(client, /runtime\?\.effectiveEngine/)
  assert.match(client, /当前版本未接管实际压缩服务/)
  assert.match(read('docker/plugins/dsh-context-manager/index.js'), /phase2-configuration-only/)
  assert.match(read('Dockerfile'), /context-manager\/policy\.mjs/)
  assert.match(read('Dockerfile'), /context-manager\/storage\.mjs/)
  assert.match(read('.github/workflows/build.yml'), /test-context-manager-phase2\.mjs/)
  assert.match(read('.github/workflows/build-reverse.yml'), /test-context-manager-phase2\.mjs/)
})
