'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require('node:path').join(__dirname, '../docker/plugins/dsh-context-manager/client.js'), 'utf8')

async function harness({ enabled = false, failSave = false, presets = [] } = {}) {
  const { defaults } = await import('../docker/plugins/dsh-context-manager/policy.mjs')
  let state = defaults(); state.nativePlugin.enabled = enabled
  if (enabled) state.engine = 'tiered'
  let definition, Panel, metadata, cursor = 0
  const values = [], effects = [], requests = []
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) {
      const complete = { ...props, children }
      return typeof type === 'function' ? type(complete) : { type, props: complete }
    },
    useState(initial) {
      const index = cursor++
      if (!Object.hasOwn(values, index)) values[index] = initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useEffect(fn) { const index = cursor++; if (!values[index]) { values[index] = true; effects.push(fn) } },
  }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(plugin) { definition = plugin } } } })
  function remote() { return { settings: state, revision: 'current', nativePlugin: {
    bootEnabled: enabled, desiredEnabled: state.nativePlugin.enabled,
    restartPending: state.nativePlugin.enabled !== enabled, presets,
  }, runtime: { effectiveEngine: enabled ? 'native-acp' : 'upstream-unmanaged' } } }
  const plugin = definition.factory(name => { assert.equal(name, 'react'); return React })
  plugin.apply({ connection: { rpc: { async call(channel, method, payload) {
    assert.equal(channel, '/dsh-docker-context-manager')
    requests.push({ method, payload: structuredClone(payload) })
    if (method === 'save') {
      if (failSave) return { ok: false, error: { message: 'revision conflict' } }
      state = structuredClone(payload.settings)
    }
    return { ok: true, value: structuredClone(remote()) }
  } } }, slots: {
    inject(_name, fn) { fn() },
    register(record, component) { metadata = record; Panel = component },
  } })
  function render() {
    cursor = 0
    const tree = Panel(metadata.inject())
    effects.splice(0).forEach(fn => fn())
    return tree
  }
  async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); return render() }
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
    const found = nodes(tree, n => n.type === 'button' && text(n) === label)
    assert.equal(found.length, 1, label); return found[0]
  }
  const toggle = tree => nodes(tree, n => n.type === 'input' && n.props['aria-label'] === '启用 billion-context 原生插件')[0]
  render()
  return { tree: await settle(), render, settle, nodes, text, button, toggle, requests }
}

test('settings expose a default-off built-in plugin without requiring environment variables', async () => {
  const app = await harness()
  assert.equal(app.toggle(app.tree).props.checked, false)
  assert.match(app.text(app.tree), /无需额外安装或配置代理/)
  assert.match(app.text(app.tree), /本次启动使用 DSH 原生压缩/)
  assert.doesNotMatch(app.text(app.tree), /TIERED_OWNER_TESTED|NO_EXTERNAL_PROXY|后续接入|分层压缩（预留）/)
})

test('one switch selects native enhancement and saves a revisioned restart-pending configuration', async () => {
  const app = await harness()
  app.toggle(app.tree).props.onChange({ target: { checked: true } })
  let tree = app.render()
  await app.button(tree, '保存设置').props.onClick()
  tree = await app.settle()
  const saved = app.requests.find(row => row.method === 'save').payload
  assert.equal(saved.revision, 'current')
  assert.equal(saved.settings.nativePlugin.enabled, true)
  assert.equal(saved.settings.engine, 'tiered')
  assert.match(app.text(tree), /有已保存变更，待重启容器/)
  assert.doesNotMatch(app.text(tree), /本次启动已启用/)
})

test('disable preserves stored settings and reports the boot state until restart', async () => {
  const app = await harness({ enabled: true })
  app.toggle(app.tree).props.onChange({ target: { checked: false } })
  await app.button(app.render(), '保存设置').props.onClick()
  const tree = await app.settle()
  const saved = app.requests.find(row => row.method === 'save').payload.settings
  assert.equal(saved.nativePlugin.enabled, false)
  assert.equal(saved.engine, 'basic')
  assert.equal(saved.tiered.retrievalEnabled, true)
  assert.match(app.text(tree), /待重启容器/)
})

test('runtime lists actual skipped presets and a failed save cannot claim activation', async () => {
  const app = await harness({ failSave: true, presets: [
    { preset: 'research', state: 'native-unchanged', reason: 'unsupported-compaction-ownership' },
  ] })
  app.toggle(app.tree).props.onChange({ target: { checked: true } })
  await app.button(app.render(), '保存设置').props.onClick()
  let tree = await app.settle()
  assert.match(app.text(tree), /revision conflict/)
  assert.doesNotMatch(app.text(tree), /设置已保存/)
  app.button(tree, '运行状态').props.onClick()
  tree = app.render()
  assert.match(app.text(tree), /research.*保留原生配置.*此预设的压缩器组成暂不支持自动接入/)
  assert.doesNotMatch(app.text(tree), /原生增强已挂载/)
})
