'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../docker/plugins/dsh-prompt-manager/client.js'), 'utf8')

function harness({ failSave = false } = {}) {
  let definition, Panel, metadata, cursor = 0
  const values = [], effects = [], requests = []
  let state = { schema: 1, globalEnabled: false, workspaceEnabled: false,
    globalText: '', deniedTools: [], revision: 'one', toolsAvailable: true }
  const permissions = { available: true, defaultPreset: 'workspace-write', tools: ['bash', 'read'],
    options: [{ value: 'workspace-write', name: 'Workspace' }, { value: 'danger-full-access', name: 'Full' }],
    sessions: [{ id: 'session-test', title: 'Test', preset: 'workspace-write',
      sandbox: 'workspace-write', approval: 'ask', running: false }] }
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: { ...props, children } } },
    useState(initial) {
      const index = cursor++
      if (!Object.hasOwn(values, index)) values[index] = initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useEffect(fn) { const index = cursor++; if (!values[index]) { values[index] = true; effects.push(fn) } },
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(plugin) { definition = plugin } } } })
  assert.equal(definition.id, 'dsh-docker-prompt-manager')
  async function call(channel, method, payload) {
    assert.equal(channel, '/dsh-docker-prompt-manager')
    requests.push({ method, payload: structuredClone(payload) })
    let value
    if (method === 'state') value = state
    else if (method === 'permissions') value = permissions
    else if (method === 'inspect') value = { available: false }
    else if (method === 'save') {
      if (failSave) return { ok: false, error: { message: 'settings changed in another page' } }
      state = { ...payload, revision: 'two', toolsAvailable: true }; value = state
    } else if (method === 'permissionSet') {
      permissions.sessions[0].preset = payload.preset
      permissions.sessions[0].sandbox = payload.preset
      permissions.sessions[0].approval = payload.preset === 'danger-full-access' ? 'never' : 'ask'
      value = permissions.sessions[0]
    } else throw Error('unexpected method ' + method)
    return { ok: true, value: structuredClone(value) }
  }
  const disposers = []
  const plugin = definition.factory(name => { assert.equal(name, 'react'); return React })
  plugin.apply({ connection: { rpc: { call } }, slots: {
    inject(name, fn) { assert.equal(name, 'settings.section'); disposers.push(fn()) },
    register(record, component) { metadata = record; Panel = component; return () => { Panel = null } },
  } })
  function render() {
    cursor = 0
    const tree = Panel(metadata.inject())
    effects.splice(0).forEach(fn => fn())
    return tree
  }
  async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); return render() }
  function nodes(root, pred, result = []) {
    if (Array.isArray(root)) root.forEach(item => nodes(item, pred, result))
    else if (root && typeof root === 'object') {
      if (pred(root)) result.push(root)
      nodes(root.props?.children, pred, result)
    }
    return result
  }
  function text(root) {
    if (Array.isArray(root)) return root.map(text).join('')
    if (root && typeof root === 'object') return text(root.props?.children)
    return typeof root === 'string' ? root : ''
  }
  function button(tree, label) {
    const found = nodes(tree, item => item.type === 'button' && text(item) === label)
    assert.equal(found.length, 1, label)
    return found[0]
  }
  render()
  return { render, settle, nodes, text, button, requests, metadata,
    unmount() { disposers.forEach(fn => fn?.()) }, mounted: () => Panel !== null }
}

test('native settings slot registers and unregisters through its owner', async () => {
  const app = harness()
  await app.settle()
  assert.equal(app.metadata.label(), '提示词与执行')
  assert.ok(app.mounted())
  app.unmount()
  assert.equal(app.mounted(), false)
})

test('editor saves literal text, explicit enablement and the exact tool deny names', async () => {
  const app = harness()
  let tree = await app.settle()
  app.nodes(tree, n => n.type === 'textarea' && n.props['aria-label'] === '全局附加指令')[0]
    .props.onChange({ target: { value: 'Literal {{x}} 中文' } })
  app.nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox')[0]
    .props.onChange({ target: { checked: true } })
  app.nodes(tree, n => n.type === 'textarea' && n.props['aria-label'] === '工具禁用名单')[0]
    .props.onChange({ target: { value: 'bash\nread' } })
  tree = app.render()
  await app.button(tree, '保存注入与工具设置').props.onClick()
  tree = await app.settle()
  const save = app.requests.find(r => r.method === 'save').payload
  assert.equal(save.globalEnabled, true)
  assert.equal(save.globalText, 'Literal {{x}} 中文')
  assert.deepEqual(Array.from(save.deniedTools), ['bash', 'read'])
  assert.equal(save.revision, 'one')
  assert.match(app.text(tree), /已保存/)
  await app.button(tree, '停用附加设置').props.onClick()
  const reset = app.requests.filter(r => r.method === 'save').at(-1).payload
  assert.deepEqual(Array.from(reset.deniedTools), [])
  assert.equal(reset.globalEnabled, false)
  assert.equal(reset.globalText, 'Literal {{x}} 中文')
})

test('permission changes are explicit, separate from draft saves and restore defaults', async () => {
  const app = harness()
  let tree = await app.settle()
  assert.equal(app.button(tree, '应用到所选会话').props.disabled, true)
  const selects = app.nodes(tree, n => n.type === 'select')
  selects[0].props.onChange({ target: { value: 'session-test' } })
  selects[1].props.onChange({ target: { value: 'danger-full-access' } })
  tree = app.render()
  assert.equal(app.button(tree, '应用到所选会话').props.disabled, false)
  await app.button(tree, '应用到所选会话').props.onClick()
  tree = await app.settle()
  assert.match(app.text(tree), /实际模式：danger-full-access；审批：never/)
  assert.equal(app.requests.filter(r => r.method === 'save').length, 0)
  await app.button(tree, '恢复所选会话默认预设').props.onClick()
  assert.equal(app.requests.filter(r => r.method === 'permissionSet').at(-1).payload.preset, 'workspace-write')
})

test('save conflicts stay visible and do not discard the unsaved draft', async () => {
  const app = harness({ failSave: true })
  let tree = await app.settle()
  app.nodes(tree, n => n.type === 'textarea' && n.props['aria-label'] === '全局附加指令')[0]
    .props.onChange({ target: { value: 'Keep my draft' } })
  tree = app.render()
  await app.button(tree, '保存注入与工具设置').props.onClick()
  tree = await app.settle()
  assert.match(app.text(tree), /settings changed/)
  assert.equal(app.nodes(tree, n => n.type === 'textarea' && n.props['aria-label'] === '全局附加指令')[0].props.value, 'Keep my draft')
})
