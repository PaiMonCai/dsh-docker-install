import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  SECTION, applyPreset, listPresets, loadPreset, readState, readActive,
  writeState, importPreset, removePreset, fingerprint, root,
} from '../core.mjs'
import { apply as mount } from '../index.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'reverse-prompt-test-'))
const baseline = () => [
  { name: 'harness:identity', text: 'Original identity' },
  { name: 'deployment:persona-prefix', text: 'You are Reverse Engineer, an authorized analyst.' },
  { name: 'tools:native', text: 'Original tool schema' },
  { name: 'plan:policy', text: 'Original approval rules' },
]
const preset = { mode: 'append', text: 'Focus on independently verified call graph evidence.' }
test('builtins exist; defaults to disabled (no modification)', () => {
  assert.ok(listPresets().includes('evidence'))
  assert.ok(listPresets().includes('concise'))
  assert.equal(readState(temp()).enabled, false)
})
test('immutable append; retained tools, policy, ordering, original source', () => {
  const before = baseline()
  const result = applyPreset(before, preset)
  assert.equal(result.changed, true)
  assert.equal(before.length, 4)
  assert.equal(result.sections[2].name, SECTION)
  assert.equal(result.sections[2].text, preset.text)
  assert.equal(result.sections[3], before[2])
  assert.equal(result.sections[4], before[3])
})
test('only the Reverse persona can be customized', () => {
  const sections = [{ name: 'deployment:persona-prefix', text: 'You are a coding agent powered by ...' }]
  const result = applyPreset(sections, preset)
  assert.equal(result.changed, false)
  assert.strictEqual(result.sections, sections)
  assert.match(result.reason, /Reverse persona/)
})
test('replace-persona touches no other section', () => {
  const before = baseline()
  const result = applyPreset(before, { mode: 'replace-persona', text: 'You analyze authorized software.' })
  assert.equal(result.sections[1].text, 'You analyze authorized software.')
  assert.equal(result.sections.length, before.length)
  assert.deepEqual(result.sections.slice(2), before.slice(2))
})
test('preset CRUD is private, atomic, reversible and respects built-in read-only', (t) => {
  const home = temp(); t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.equal(readState(home).enabled, false)
  importPreset('custom-review', 'Review authorized binaries with verifiable evidence.', home)
  assert.ok(listPresets(home).includes('custom-review'))
  writeState({ schema: 1, enabled: true, active: 'custom-review' }, home)
  assert.equal(readActive(home).preset.name, 'custom-review')
  assert.match(readFileSync(join(root(home), 'state.json'), 'utf8'), /custom-review/)
  assert.throws(() => removePreset('custom-review', home), /disable or switch/)
  writeState({ schema: 1, enabled: false, active: 'custom-review' }, home)
  removePreset('custom-review', home)
  assert.equal(listPresets(home).includes('custom-review'), false)
  assert.throws(() => importPreset('evidence', 'Cannot override builtins.', home), /read-only/)
})
test('bad names, templating, invalid state and unsafe file symlinks fail closed', (t) => {
  const home = temp(); t.after(() => rmSync(home, { recursive: true, force: true }))
  assert.throws(() => importPreset('../escape', 'bad', home), /invalid preset name/)
  assert.throws(() => importPreset('test', '{{secret}}', home), /not supported/)
  assert.throws(() => importPreset('test', 'x'.repeat(13000), home), /invalid prompt preset/)
  mkdirSync(root(home), { recursive: true })
  writeFileSync(join(root(home), 'state.json'), '{ broken json')
  assert.throws(() => readState(home))
  rmSync(join(root(home), 'state.json'))
  symlinkSync('/etc/passwd', join(root(home), 'state.json'))
  assert.throws(() => readState(home))
})
test('plugin ignores other agents and supports next-assembly enable/disable, no HMR', async (t) => {
  const home = temp(); t.after(() => rmSync(home, { recursive: true, force: true }))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old })
  let callback
  const ctx = { agentPresets: { composedPreset: agent => agent.mode },
    on: (name, fn) => { assert.equal(name, 'system-prompt/assemble'); callback = fn },
    logger: { warn: () => {} } }
  mount(ctx)
  const run = mode => callback(null, { agent: { ctx: { mode } } },
    async () => ({ sections: baseline(), variables: { cwd: '/workspace' } }))
  assert.equal((await run('reverse-engineering')).sections.length, 4)
  writeState({ schema: 1, enabled: true, active: 'evidence' }, home)
  assert.equal((await run('standard')).sections.length, 4)
  assert.equal((await run('reverse-engineering')).sections.length, 5)
  writeState({ schema: 1, enabled: false, active: 'evidence' }, home)
  assert.equal((await run('reverse-engineering')).sections.length, 4)
  writeFileSync(join(root(home), 'state.json'), 'invalid')
  assert.equal((await run('reverse-engineering')).sections.length, 4)
})
test('CLI can activate, preview, and disable the same preset with no restart', (t) => {
  const home = temp(); t.after(() => rmSync(home, { recursive: true, force: true }))
  const path = new URL('../cli.mjs', import.meta.url)
  const env = { ...process.env, DSH_HOME: home }
  const call = (...args) => spawnSync(process.execPath, [path.pathname, ...args], { env, encoding: 'utf8' })
  assert.equal(call('activate', 'evidence').status, 0)
  const preview = call('preview')
  assert.equal(preview.status, 0, preview.stderr)
  assert.equal(JSON.parse(preview.stdout).changed, true)
  assert.equal(call('disable').status, 0)
  assert.equal(JSON.parse(call('status').stdout).enabled, false)
})
