#!/usr/bin/env node
/**
 * Browser-slot integration tests with a minimal React hooks simulator.
 * Exercises real event handlers, canonical Settings mutations, and conflict fences.
 * No DOM queries, browser storage or second persistence layer.
 */
'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const source = fs.readFileSync(path.join(__dirname, '../docker/plugins/dsh-reasoning-editor/client.js'), 'utf8')

function harness(initial) {
  let definition, slotRenderer
  let models = structuredClone(initial)
  let revision = 1
  let mutations = 0
  const values = [], deps = []
  let cursor = 0
  const effects = []
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useState(initialValue) {
      const index = cursor++
      if (!Object.hasOwn(values, index)) values[index] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [values[index], next => {
        values[index] = typeof next === 'function' ? next(values[index]) : next
      }]
    },
    useMemo(callback, depList) {
      const index = cursor++
      if (!deps[index] || !sameDeps(deps[index], depList)) {
        deps[index] = [...depList]
        values[index] = callback()
      }
      return values[index]
    },
    useCallback(callback, depList) { return React.useMemo(() => callback, depList) },
    useEffect(callback, depList) {
      const index = cursor++
      if (!deps[index] || !sameDeps(deps[index], depList)) {
        deps[index] = [...depList]
        effects.push(callback)
      }
    },
  }
  function sameDeps(a, b) {
    return Array.isArray(a) && a.length === b.length && a.every((entry, i) => Object.is(entry, b[i]))
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: plugin => { definition = plugin } } },
    document: { documentElement: { lang: 'zh-CN' } },
    navigator: { language: 'zh-CN' },
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.equal(definition.id, 'dsh-docker-reasoning-editor')
  const plugin = definition.factory(name => {
    if (name === 'react') return React
    throw new Error('unexpected import ' + name)
  })
  const settings = {
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [{
      ns: 'llm-pi-ai', revision,
      user: { providers: { route: { models: structuredClone(models) } } },
      value: { providers: { route: { models: structuredClone(models) } } },
    }] } }),
    mutate: async (ns, operations, expectedRevision) => {
      assert.equal(ns, 'llm-pi-ai')
      if (expectedRevision !== revision) return { ok: false, error: { code: 'settings/conflict' } }
      assert.equal(operations.length, 1)
      assert.deepEqual(Array.from(operations[0].path), ['providers', 'route', 'models'])
      models = structuredClone(operations[0].value)
      revision++
      mutations++
      return { ok: true }
    },
  }
  plugin.apply({ slots: {
    inject(name, create) {
      assert.equal(name, 'settings.models.provider-card')
      create()
    },
    register(record, callback) {
      assert.equal(record.key, 'llm-pi-ai')
      slotRenderer = callback
    },
  }, remote: { settings } })
  const provider = { settingsNs: 'llm-pi-ai', declared: true, provider: 'route', settingsPath: ['providers', 'route'] }
  const owner = { provider, configured: true }
  function render() {
    cursor = 0
    const wrapper = slotRenderer(owner)
    const tree = wrapper.type(wrapper.props)
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 12; i++) await Promise.resolve()
    return render()
  }
  function nodes(root, pred, result = []) {
    if (root == null || root === false) return result
    if (Array.isArray(root)) { root.forEach(item => nodes(item, pred, result)); return result }
    if (typeof root !== 'object') return result
    if (pred(root)) result.push(root)
    nodes(root.props?.children, pred, result)
    return result
  }
  function textOf(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node && typeof node === 'object') return textOf(node.props?.children)
    return ''
  }
  function byText(root, tag, exact) {
    const found = nodes(root, node => node.type === tag && textOf(node).trim() === exact)
    assert.equal(found.length, 1, tag + ' ' + exact + ' found ' + found.length)
    return found[0]
  }
  function byAttr(root, tag, key, value) {
    const found = nodes(root, node => node.type === tag && node.props?.[key] === value)
    assert.equal(found.length, 1, tag + '[' + key + '=' + value + '] found ' + found.length)
    return found[0]
  }
  async function open() {
    byText(render(), 'button', '配置').props.onClick()
    await settle()
    return settle()
  }
  return {
    render, settle, open, byText, byAttr, nodes,
    get models() { return models },
    set models(updated) { models = structuredClone(updated); revision++ },
    get mutations() { return mutations },
  }
}
function models() {
  return [
    { id: 'alpha', name: 'Alpha', reasoningEfforts: { off: null, high: 'high' },
      contextWindow: 100, compat: { thinkingFormat: 'deepseek' } },
    { id: 'beta', name: 'Beta', reasoningEfforts: false,
      contextWindow: 200, cost: { input: 1 } },
    { id: 'gamma', name: 'Gamma', input: ['text'], contextWindow: 300 },
  ]
}
test('bulk-select and disabled mode uses one canonical mutation, preserving other fields', async () => {
  const ui = harness(models())
  let tree = await ui.open()
  ui.byText(tree, 'button', '全选全部').props.onClick()
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox' && n.props.checked === true).length, 3)
  const select = ui.nodes(tree, n => n.type === 'select')[0]
  select.props.onChange({ target: { value: 'disabled' } })
  tree = ui.render()
  ui.byText(tree, 'button', '应用到已选模型').props.onClick()
  tree = ui.render()
  assert.equal(ui.byText(tree, 'button', '保存 2 个模型的修改').props.disabled, false)
  ui.byText(tree, 'button', '保存 2 个模型的修改').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations, 1)
  assert.deepEqual(ui.models.map(m => m.reasoningEfforts), [false,false,false])
  assert.equal(ui.models[0].contextWindow,100)
  assert.equal(ui.models[1].cost.input,1)
  assert.deepEqual(ui.models[2].input,['text'])
})
test('filter and select filtered modifies only matching models', async () => {
  const ui = harness(models())
  let tree = await ui.open()
  ui.byAttr(tree, 'input', 'type', 'search').props.onChange({ target: { value: 'beta' } })
  tree = ui.render()
  ui.byText(tree, 'button', '选择筛选结果').props.onClick()
  tree = ui.render()
  ui.nodes(tree, n => n.type === 'select')[0].props.onChange({target:{value:'inherit'}})
  tree = ui.render()
  ui.byText(tree, 'button', '应用到已选模型').props.onClick()
  tree = ui.render()
  ui.byText(tree, 'button', '保存 1 个模型的修改').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations,1)
  assert.equal(Object.hasOwn(ui.models[1],'reasoningEfforts'),false)
  assert.deepEqual(ui.models[0].reasoningEfforts,{ off:null, high:'high' })
})
test('batch custom mode rejects off-only drafts before applying', async () => {
  const ui=harness(models());let tree=await ui.open()
  ui.byText(tree,'button','全选全部').props.onClick()
  tree=ui.render()
  ui.nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'custom'}})
  tree=ui.render()
  ui.byAttr(tree,'button','aria-label','批量设置 off').props.onClick()
  tree=ui.render()
  ui.byText(tree,'button','应用到已选模型').props.onClick()
  tree=ui.render()
  assert.equal(ui.byText(tree,'button','保存 0 个模型的修改').props.disabled,true)
  assert.equal(ui.mutations,0)
})
test('concurrent reasoning edit on a targeted model rejects overwrite',async()=>{
  const ui=harness(models());let tree=await ui.open()
  ui.byText(tree,'button','全选全部').props.onClick()
  tree=ui.render()
  ui.nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'inherit'}})
  tree=ui.render()
  ui.byText(tree,'button','应用到已选模型').props.onClick()
  const changed=ui.models;changed[0].reasoningEfforts={high:'xhigh'};ui.models=changed
  tree=ui.render()
  ui.byText(tree,'button','保存 2 个模型的修改').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations,0)
  assert.deepEqual(ui.models[0].reasoningEfforts,{high:'xhigh'})
})
test('simultaneous changes to unrelated fields and unselected models are preserved',async()=>{
  const ui=harness(models());let tree=await ui.open()
  ui.byAttr(tree,'input','aria-label','批量设置: beta').props.onChange({target:{checked:true}})
  tree=ui.render()
  ui.nodes(tree,n=>n.type==='select')[0].props.onChange({target:{value:'inherit'}})
  tree=ui.render()
  ui.byText(tree,'button','应用到已选模型').props.onClick()
  const newer=ui.models
  newer[0].reasoningEfforts={off:null,high:'xhigh'}
  newer[1].contextWindow=999
  ui.models=newer
  tree=ui.render()
  ui.byText(tree,'button','保存 1 个模型的修改').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations,1)
  assert.equal(ui.models[1].contextWindow,999)
  assert.equal(Object.hasOwn(ui.models[1],'reasoningEfforts'),false)
  assert.equal(ui.models[0].reasoningEfforts.high,'xhigh')
})
