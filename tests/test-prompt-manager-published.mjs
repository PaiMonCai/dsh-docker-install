/** Real published Cordis/SystemPrompt/ToolRuntime integration. No model or external tool execution. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const runtimeRoot = process.env.DSH_PROMPT_RUNTIME_ROOT
test('published DSH renders literal guidance and enforces tools through its real guard lifecycle',
  { skip: !runtimeRoot && 'set DSH_PROMPT_RUNTIME_ROOT to installed DSH package root' }, async t => {
    const require = createRequire(join(runtimeRoot, 'package.json'))
    const load = name => import(pathToFileURL(require.resolve(name)))
    const [{ Context }, { SystemPrompt, renderPrompt }, { ToolRuntime }] = await Promise.all([
      load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'),
    ])
    const pluginRoot = process.env.DSH_PROMPT_PLUGIN_ROOT
      ? pathToFileURL(join(process.env.DSH_PROMPT_PLUGIN_ROOT, '/')).href : new URL('../docker/plugins/dsh-prompt-manager/', import.meta.url).href
    const [{ default: plugin }, { readState, writeState }] = await Promise.all([
      import(new URL('index.js', pluginRoot)), import(new URL('core.mjs', pluginRoot)),
    ])
    const home = mkdtempSync(join(tmpdir(), 'dsh-prompt-native-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const ctx = new Context()
    const fibers = []
    t.after(async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    })
    async function mount(value, config) {
      const fiber = ctx.plugin(value, config)
      fibers.push(fiber); await fiber.await(); return fiber
    }
    await mount(SystemPrompt, { personaPrefix: 'Official persona' })
    await mount(ToolRuntime)
    let calls = 0, nestedDenied = false
    const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }
    ctx.tools.register({ name: 'fixture', description: 'Harmless fixture',
      parameters: { type: 'object', properties: {} }, output, execute: async () => { calls++; return 'ok' } })
    ctx.tools.register({ name: 'wrapper', description: 'Nested harmless fixture',
      parameters: { type: 'object', properties: {} }, output, execute: async (_args, exec) => {
        const result = await ctx.tools.execute({ name: 'fixture', arguments: {}, callId: 'nested',
          signal: exec.signal, parent: exec })
        nestedDenied = result.isError === true
        return 'nested checked'
      } })
    const feature = await mount(plugin)
    const state = readState()
    writeState({ ...state, globalEnabled: true, globalText: 'Literal {{unknown_variable}}', deniedTools: ['fixture'] })
    const prompt = await ctx.systemPrompt.assemble()
    assert.match(renderPrompt(prompt), /Official persona/)
    assert.match(renderPrompt(prompt), /Literal \{\{unknown_variable\}\}/)
    assert.ok(prompt.tools.some(tool => tool.name === 'fixture'), 'schemas remain owned by native runtime')
    const execute = name => ctx.tools.execute({ name, callId: name, arguments: {}, signal: new AbortController().signal })
    assert.equal((await execute('fixture')).isError, true)
    assert.equal(calls, 0, 'blocked tool body was never entered')
    assert.notEqual((await execute('wrapper')).isError, true)
    assert.equal(nestedDenied, true, 'nested execution passed the same guard')
    assert.equal(calls, 0)
    // Unregistering this feature lifts only its own guard and assembly hook.
    await feature.dispose()
    assert.notEqual((await execute('fixture')).isError, true)
    assert.equal(calls, 1)
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble()).includes('Literal'), false)
    // Independent policy owners still deny permitted calls.
    ctx.tools.guard(() => 'Independent owner denies this call')
    assert.equal((await execute('fixture')).isError, true)
    assert.equal(calls, 1)
  })

test('published permission owner writes replayable sandbox/approval events and never does not auto-grant',
  { skip: !runtimeRoot && 'set DSH_PROMPT_RUNTIME_ROOT to installed DSH package root' }, async t => {
    const require = createRequire(join(runtimeRoot, 'package.json'))
    const load = name => import(pathToFileURL(require.resolve(name)))
    const [{ Context }, { PermissionPresetService }, { SandboxPolicyService }, { ApprovalService },
      { SessionProjectionRegistry }] = await Promise.all([
      load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-permission-presets'),
      load('@deepseek-ai/dsh-sandbox-policy'), load('@deepseek-ai/dsh-user-approval'),
      load('@deepseek-ai/dsh-session-projection'),
    ])
    const pluginRoot = process.env.DSH_PROMPT_PLUGIN_ROOT
      ? pathToFileURL(join(process.env.DSH_PROMPT_PLUGIN_ROOT, '/')).href : new URL('../docker/plugins/dsh-prompt-manager/', import.meta.url).href
    const { setPermission } = await import(new URL('permissions.mjs', pluginRoot))
    const events = []
    const session = { id: 'session-native-fixture', header: { cwd: '/workspace' }, inheritedEventCount: 0,
      get seq() { return events.length }, snapshotEvents: () => events.slice(), eventAt: seq => events[seq],
      append(type, data) { events.push({ seq: events.length, type, data }) } }
    const ctx = new Context()
    ctx.provide('shell', { sandboxMode: 'workspace-write' })
    ctx.provide('sessions', { list: () => [session], get: id => id === session.id ? session : undefined })
    ctx.provide('agents', { get: () => ({ status: 'idle' }) })
    const fibers = []
    t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
    async function mount(value, config) {
      const fiber = ctx.plugin(value, config); fibers.push(fiber); await fiber.await()
    }
    await mount(SessionProjectionRegistry)
    await mount(ApprovalService)
    await mount(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: '/workspace' })
    await mount(PermissionPresetService)
    assert.equal(ctx.permissionPresets.current(session), 'workspace-write')
    setPermission(ctx, { sessionId: session.id, preset: 'danger-full-access' })
    assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, 'danger-full-access')
    assert.equal(ctx.approval.effectivePolicy(session), 'never')
    assert.deepEqual(events.slice(-3).map(event => event.type), ['permission/preset', 'sandbox/mode', 'approval/policy'])
    assert.equal(await ctx.approval.decide({ agent: { session } }, session), 'rejected')
    // A fresh Session identity with the same durable events replays identically.
    const replayed = { ...session, get seq() { return events.length } }
    assert.equal(ctx.permissionPresets.current(replayed), 'danger-full-access')
    assert.equal(ctx.sandboxPolicy.resolve({ session: replayed }).mode, 'danger-full-access')
    setPermission(ctx, { sessionId: session.id, preset: ctx.permissionPresets.catalog().defaultPreset })
    assert.equal(ctx.sandboxPolicy.resolve({ session }).mode, 'workspace-write')
    assert.equal(ctx.approval.effectivePolicy(session), 'ask')
  })
