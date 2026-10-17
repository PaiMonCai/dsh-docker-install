import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assemblePrompt, readState, writeState, statePath, revision, LIMIT, SECTION,
  WORKSPACE_SECTION, TOOL_SECTION } from '../docker/plugins/dsh-prompt-manager/core.mjs'
import { apply, ENDPOINT } from '../docker/plugins/dsh-prompt-manager/index.js'
import { permissionStatus, setPermission } from '../docker/plugins/dsh-prompt-manager/permissions.mjs'

function home(t) {
  const folder = mkdtempSync(join(tmpdir(), 'dsh-prompt-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}
function baseline() {
  return { sections: [
    { name: 'harness:identity', text: 'Official identity' },
    { name: 'deployment:persona-prefix', text: 'Official persona' },
    { name: 'plan:policy', text: 'Plan policy' },
  ], contexts: [{ name: 'sandbox:policy', text: 'Actual sandbox' }],
  tools: [{ name: 'read', parameters: { type: 'object' } }], variables: { cwd: '/workspace' } }
}
const config = overrides => ({ schema: 1, globalEnabled: false, workspaceEnabled: false,
  globalText: '', deniedTools: [], ...overrides })

test('default state is inert and reading does not initialize files', t => {
  const dir = home(t)
  assert.deepEqual(readState(dir), config())
  assert.equal(existsSync(statePath(dir)), false)
  const before = baseline()
  assert.equal(assemblePrompt(before, readState(dir)).assembly, before)
})

test('literal additive instructions preserve native sections, tool schemas and context', () => {
  const before = baseline()
  const snapshot = structuredClone(before)
  const state = config({ globalEnabled: true, globalText: 'Keep literal {{private_key}} and 中文' })
  const result = assemblePrompt(before, state)
  assert.deepEqual(before, snapshot)
  assert.deepEqual(result.assembly.sections.slice(0, 3), before.sections)
  assert.equal(result.assembly.contexts, before.contexts)
  assert.equal(result.assembly.tools, before.tools)
  assert.equal(result.assembly.variables, before.variables)
  assert.equal(result.assembly.sections[3].interpolate, false)
  assert.match(result.assembly.sections[3].text, /\{\{private_key\}\}/)
  assert.equal(result.injected[0].sha256.length, 64)
  assert.equal(JSON.stringify(result.injected).includes('private_key'), false)
})

test('reassembly deduplicates only owned blocks and disabling removes stale owned blocks', () => {
  const state = config({ globalEnabled: true, globalText: 'First', deniedTools: ['bash'] })
  const first = assemblePrompt(baseline(), state).assembly
  const second = assemblePrompt(first, { ...state, globalText: 'Updated' }).assembly
  assert.equal(second.sections.filter(s => s.name === SECTION).length, 1)
  assert.equal(second.sections.find(s => s.name === SECTION).text, 'Updated')
  assert.equal(second.sections.filter(s => s.name === TOOL_SECTION).length, 1)
  assert.deepEqual(assemblePrompt(second, config()).assembly, baseline())
})

test('workspace guidance is bounded to ancestors and refreshes without duplicating AGENTS', t => {
  const root = home(t)
  const cwd = join(root, 'project', 'src')
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(root, 'DSH_PROMPT.md'), 'Parent guidance')
  writeFileSync(join(root, 'project', 'DSH_PROMPT.md'), 'Project guidance {{literal}}')
  writeFileSync(join(cwd, 'AGENTS.md'), 'Native AGENTS content must stay with native owner')
  const state = config({ workspaceEnabled: true })
  const first = assemblePrompt(baseline(), state, cwd, root)
  assert.deepEqual(first.workspace.sources, ['DSH_PROMPT.md', 'project/DSH_PROMPT.md'])
  const text = first.assembly.sections.find(s => s.name === WORKSPACE_SECTION).text
  assert.ok(text.indexOf('Parent guidance') < text.indexOf('Project guidance'))
  assert.equal(text.includes('Native AGENTS'), false)
  writeFileSync(join(root, 'project', 'DSH_PROMPT.md'), 'New content')
  const next = assemblePrompt(baseline(), state, cwd, root)
  assert.match(next.assembly.sections.at(-1).text, /New content/)
  assert.equal(assemblePrompt(baseline(), state, tmpdir(), root).injected.length, 0)
})

test('oversized guidance skips the entire workspace addition and reports a reason', t => {
  const root = home(t)
  const child = join(root, 'child')
  mkdirSync(child)
  writeFileSync(join(root, 'DSH_PROMPT.md'), 'a'.repeat(10000))
  writeFileSync(join(child, 'DSH_PROMPT.md'), 'b'.repeat(10000))
  const result = assemblePrompt(baseline(), config({ workspaceEnabled: true }), child, root)
  assert.equal(result.injected.length, 0)
  assert.match(result.workspace.reason, /limit/)
})

test('workspace file symlinks are refused', t => {
  const root = home(t)
  const target = join(root, 'target.md')
  writeFileSync(target, 'Do not follow')
  try { symlinkSync(target, join(root, 'DSH_PROMPT.md')) }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlink privilege unavailable'); throw error }
  const result = assemblePrompt(baseline(), config({ workspaceEnabled: true }), root, root)
  assert.equal(result.injected.length, 0)
  assert.match(result.workspace.reason, /unsafe/)
})

test('state round trips serialized escapes, UTF-8 limits and rejects stale saves', t => {
  const dir = home(t)
  const originalRevision = revision(readState(dir))
  const saved = writeState(config({ globalEnabled: true, globalText: '\n'.repeat(LIMIT),
    deniedTools: ['bash', 'read', 'bash'] }), dir, originalRevision)
  assert.deepEqual(readState(dir), saved)
  assert.deepEqual(saved.deniedTools, ['bash', 'read'])
  assert.throws(() => writeState(config(), dir, originalRevision), /another page/)
  assert.throws(() => writeState(config({ globalText: '中'.repeat(LIMIT) }), dir), /invalid/)
  assert.throws(() => writeState(config({ deniedTools: ['bad name'] }), dir), /exact tool names/)
  assert.deepEqual(readState(dir), saved)
})

test('corrupted state is detected and a managed directory symlink is rejected', t => {
  const dir = home(t)
  writeState(config(), dir)
  writeFileSync(statePath(dir), '{')
  assert.throws(() => readState(dir))
  const linked = home(t)
  try { symlinkSync(join(dir, 'dsh-docker'), join(linked, 'dsh-docker'), 'junction') }
  catch (error) { if (error.code === 'EPERM') return t.skip('symlink privilege unavailable'); throw error }
  assert.throws(() => writeState(config(), linked), /unsafe/)
})

function mounted(t, { tools = true, execution = null } = {}) {
  const dir = home(t)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  t.after(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous })
  let rpc, assembly, guard
  const effects = []
  const child = { effect(fn) { effects.push(fn()) } }
  const ctx = {
    logger: { warn() {} },
    on(event, fn) { assert.equal(event, 'system-prompt/assemble'); assembly = fn },
    inject(names, fn) {
      if (names[0] === 'tools' && tools) fn({ ...child, tools: {
        guard(fn) { guard = fn }, schemas: () => [{ name: 'bash' }],
      } })
      if (names[0] === 'permissionPresets' && execution) fn({ ...child, ...execution })
      if (names[0] === 'connection') fn({ connection: { rpc: { handle(path, fn) {
        assert.equal(path, ENDPOINT); rpc = fn
      } } } })
    },
  }
  apply(ctx)
  return { dir, rpc: (...args) => rpc(...args),
    assembly: async original => assembly(null, { agent: { session: { header: { cwd: '/workspace' } } } }, () => original),
    guard: (...args) => guard(...args), effects }
}

test('runtime reads saved state each assembly and guard enforces actual calls', async t => {
  const runtime = mounted(t)
  const initial = (await runtime.rpc('state')).value
  assert.equal(initial.globalEnabled, false)
  const saved = await runtime.rpc('save', { ...initial, globalEnabled: true,
    globalText: 'Private instruction', deniedTools: ['bash'] })
  assert.equal(saved.ok, true)
  assert.match(runtime.guard({ name: 'bash' }), /disabled/)
  assert.equal(runtime.guard({ name: 'read' }), undefined)
  const result = await runtime.assembly(baseline())
  assert.equal(result.sections.find(s => s.name === SECTION).text, 'Private instruction')
  const diagnostic = (await runtime.rpc('inspect')).value
  assert.equal(diagnostic.injected.length, 2)
  assert.equal(JSON.stringify(diagnostic).includes('Private instruction'), false)
  assert.equal((await runtime.rpc('save', { ...initial })).ok, false)
  assert.equal((await runtime.rpc('save', null)).ok, false)
  writeFileSync(statePath(runtime.dir), '{')
  assert.match(runtime.guard({ name: 'read' }), /policy unavailable/)
  const original = baseline()
  assert.equal(await runtime.assembly(original), original)
})

test('missing optional tool and permission services remain inert and explicit', async t => {
  const runtime = mounted(t, { tools: false })
  const initial = (await runtime.rpc('state')).value
  assert.equal(initial.toolsAvailable, false)
  assert.equal((await runtime.rpc('permissions')).value.available, false)
  assert.equal((await runtime.rpc('save', { ...initial, deniedTools: ['bash'] })).ok, false)
  assert.equal((await runtime.rpc('save', { ...initial, globalEnabled: true, globalText: 'Still works' })).ok, true)
  assert.equal((await runtime.rpc('permissionSet', { sessionId: 'session-test', preset: 'danger-full-access' })).ok, false)
})

function permissions() {
  const session = { id: 'session-test', header: { title: 'Test session' } }
  let running = false, current = 'workspace-write', calls = 0
  const catalog = { defaultPreset: 'workspace-write', options: [
    { value: 'workspace-write', name: 'Workspace' }, { value: 'danger-full-access', name: 'Full' },
  ] }
  const ctx = { sessions: { get: id => id === session.id ? session : undefined, list: () => [session] },
    agents: { get: () => ({ status: running ? 'running' : 'idle' }) },
    permissionPresets: { catalog: () => catalog, current: () => current,
      set: (target, value) => { assert.equal(target, session); calls++; current = value } },
    sandboxPolicy: { resolve: () => ({ mode: current }) },
    approval: { effectivePolicy: () => current === 'danger-full-access' ? 'never' : 'ask' } }
  return { ctx, calls: () => calls, run: () => { running = true } }
}

test('permission controls delegate to the canonical owner and restore the actual default', () => {
  const service = permissions()
  assert.equal(permissionStatus(service.ctx).sessions[0].approval, 'ask')
  const result = setPermission(service.ctx, { sessionId: 'session-test', preset: 'danger-full-access' })
  assert.equal(result.approval, 'never')
  assert.equal(service.calls(), 1)
  const defaultPreset = permissionStatus(service.ctx).defaultPreset
  assert.equal(setPermission(service.ctx, { sessionId: 'session-test', preset: defaultPreset }).sandbox, 'workspace-write')
  assert.throws(() => setPermission(service.ctx, { sessionId: 'session-missing', preset: defaultPreset }), /not currently loaded/)
  assert.throws(() => setPermission(service.ctx, { sessionId: 'session-test', preset: 'force-allow' }), /unknown/)
  service.run()
  assert.throws(() => setPermission(service.ctx, { sessionId: 'session-test', preset: 'danger-full-access' }), /stop/)
  assert.equal(service.calls(), 2)
})

test('native image integration includes an explicit disable switch and both compose variants', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  assert.match(read('docker/entrypoint.sh'), /DSH_PROMPT_MANAGER:-true/)
  assert.match(read('Dockerfile'), /COPY docker\/plugins\/dsh-prompt-manager\//)
  for (const file of ['docker-compose.yml', 'docker-compose.reverse.yml'])
    assert.match(read(file), /DSH_PROMPT_MANAGER: "\$\{DSH_PROMPT_MANAGER:-true\}"/)
  const manifest = JSON.parse(read('docker/plugins/dsh-prompt-manager/package.json'))
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
})
