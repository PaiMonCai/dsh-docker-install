#!/usr/bin/env node
'use strict'
/**
 * Regression tests for the real injected Web UI. The minimal React/DOM shell
 * tests event handlers without requiring an unrelated headless browser stack.
 */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname,
  '../docker/plugins/dsh-session-manager-web/client.js'), 'utf8')

const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString()
const seeds = () => [
  { sessionId: 'session-alpha', title: '市场分析', deletedAt: daysAgo(1) },
  { sessionId: 'session-beta', title: '数学笔记', deletedAt: daysAgo(15) },
  { sessionId: 'session-gamma', title: '经济学', deletedAt: daysAgo(3) },
]

function harness(input = seeds(), reject = new Set()) {
  let definition
  const slots = new Map()
  let items = structuredClone(input)
  const mutations = []
  let cursor = 0
  const states = []
  const deps = []
  const effects = []
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useState(initial) {
      const i = cursor++
      if (!Object.hasOwn(states, i)) states[i] = typeof initial === 'function' ? initial() : initial
      return [states[i], next => {
        states[i] = typeof next === 'function' ? next(states[i]) : next
      }]
    },
    useRef(initial) {
      const i = cursor++
      if (!Object.hasOwn(states, i)) states[i] = { current: initial }
      return states[i]
    },
    useEffect(callback, next) {
      const i = cursor++
      if (!deps[i] || !sameDeps(deps[i], next)) {
        deps[i] = [...next]
        effects.push(callback)
      }
    },
    useSyncExternalStore(subscribe, snapshot) {
      cursor++
      return snapshot()
    },
  }
  function sameDeps(a, b) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  }
  const document = {
    activeElement: null,
    body: { style: { overflow: '' } },
    addEventListener() {},
    removeEventListener() {},
  }
  async function fetch(url, options = {}) {
    assert.equal(url, '/api/dsh-docker-session-manager')
    if (options.method !== 'POST') return {
      ok: true, async json() { return { items: structuredClone(items) } },
    }
    const body = JSON.parse(options.body)
    assert.match(body.sessionId, /^session-/)
    mutations.push(body)
    if (reject.has(body.sessionId)) return {
      ok: false, async json() { return { error: 'operation-failed' } },
    }
    if (body.action === 'purge' || body.action === 'restore') {
      items = items.filter(row => row.sessionId !== body.sessionId)
    }
    return { ok: true, async json() { return { success: true } } }
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: plugin => { definition = plugin } } },
    document, fetch, console,
    setTimeout() { return 1 }, clearTimeout() {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'session-manager-client.js' })
  assert.equal(definition.id, 'dsh-docker-session-manager')
  function Modal() {}
  function MenuItemButton() {}
  const plugin = definition.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal, MenuItemButton }
    throw Error('unexpected require ' + name)
  })
  plugin.apply({ slots: {
    inject(name, factory) {
      const values = factory()
      if (values && typeof values.next === 'function') for (const _ of values) {}
    },
    register(props, component) { slots.set(props.name, component) },
  } })
  const Footer = slots.get('sidebar.footer.action')
  const Dialog = slots.get('shell.overlay')
  assert.equal(typeof Footer, 'function')
  assert.equal(typeof Dialog, 'function')

  function render() {
    cursor = 0
    const tree = Dialog()
    for (const fn of effects.splice(0)) fn()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    return render()
  }
  function nodes(root, predicate, result = []) {
    if (root == null || root === false) return result
    if (Array.isArray(root)) { root.forEach(entry => nodes(entry, predicate, result)); return result }
    if (typeof root !== 'object') return result
    if (predicate(root)) result.push(root)
    nodes(root.props?.children, predicate, result)
    if (root.type === Modal) nodes(root.props?.footer, predicate, result)
    return result
  }
  function label(root, type, value) {
    const matches = nodes(root, x => x.type === type && x.props?.['aria-label'] === value)
    assert.equal(matches.length, 1, type + ' aria-label=' + value)
    return matches[0]
  }
  function textOf(node) {
    if (node == null || node === false) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    return textOf(node.props?.children)
  }
  function named(root, type, value) {
    const matches = nodes(root, x => x.type === type && textOf(x) === value)
    assert.equal(matches.length, 1, type + ' "' + value + '" matched ' + matches.length)
    return matches[0]
  }
  async function open() {
    Footer({ wide: true }).props.onClick()
    render()
    return settle()
  }
  return {
    open, render, settle, nodes, label, named, textOf, Modal,
    get items() { return items },
    get mutations() { return mutations },
  }
}

test('wide accessible recycle dialog offers responsive workspace and toolbar', async () => {
  const ui = harness()
  const tree = await ui.open()
  assert.equal(tree.props.className, 'dsh-trash-overlay')
  assert.equal(ui.nodes(tree, n => n.type === 'section' && n.props.role === 'dialog'
    && n.props['aria-modal'] === 'true').length, 1)
  const css = ui.nodes(tree, n => n.type === 'style')[0].props.children[0]
  assert.match(css, /width:min\(980px,96vw\)/)
  assert.match(css, /@media\(max-width:640px\)/)
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 3)
  assert.ok(ui.label(tree, 'input', '搜索会话名称或 ID'))
  assert.ok(ui.label(tree, 'select', '删除时间'))
  assert.ok(ui.label(tree, 'select', '排序方式'))
})

test('search, date range, sort and select-visible apply only to visible rows', async () => {
  const ui = harness()
  let tree = await ui.open()
  ui.label(tree, 'input', '搜索会话名称或 ID').props.onChange({ target: { value: '经济' } })
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 1)
  ui.label(tree, 'input', '搜索会话名称或 ID').props.onChange({ target: { value: '' } })
  ui.label(tree, 'select', '删除时间').props.onChange({ target: { value: '7' } })
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 2)
  ui.label(tree, 'input', '选择当前结果').props.onChange({ target: { checked: true } })
  tree = ui.render()
  assert.match(ui.textOf(tree), /已选择\s*2/)
  ui.named(tree, 'button', '恢复选中').props.onClick()
  tree = await ui.settle()
  assert.deepEqual(ui.mutations.filter(x => x.action === 'restore')
    .map(x => x.sessionId), ['session-alpha', 'session-gamma'])
  assert.deepEqual(ui.items.map(x => x.sessionId), ['session-beta'])
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 0)
  ui.named(tree, 'button', '清除筛选').props.onClick()
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 1)
})

test('bulk permanent deletion requires explicit typed confirmation and only deletes selected', async () => {
  const ui = harness()
  let tree = await ui.open()
  ui.label(tree, 'input', '选择会话 session-alpha')
    .props.onChange({ target: { checked: true } })
  ui.label(tree, 'input', '选择会话 session-gamma')
    .props.onChange({ target: { checked: true } })
  tree = ui.render()
  ui.named(tree, 'button', '永久删除选中').props.onClick()
  tree = ui.render()
  assert.equal(tree.type, ui.Modal)
  assert.equal(ui.named(tree, 'button', '确认删除 2 个会话').props.disabled, true)
  ui.label(tree, 'input', '批量删除前请输入“永久删除”以确认')
    .props.onChange({ target: { value: '永久删除' } })
  tree = ui.render()
  const confirm = ui.named(tree, 'button', '确认删除 2 个会话')
  assert.equal(confirm.props.disabled, false)
  confirm.props.onClick()
  await ui.settle()
  tree = await ui.settle()
  assert.equal(ui.items.length, 1)
  assert.equal(ui.items[0].sessionId, 'session-beta')
  assert.equal(ui.mutations.filter(x => x.action === 'purge').length, 2)
})

test('failed batch restore leaves failures in trash and still restores remaining', async () => {
  const ui = harness(seeds(), new Set(['session-alpha']))
  let tree = await ui.open()
  ui.label(tree, 'input', '选择当前结果').props.onChange({ target: { checked: true } })
  tree = ui.render()
  ui.named(tree, 'button', '恢复选中').props.onClick()
  tree = await ui.settle()
  assert.equal(ui.items.length, 1)
  assert.equal(ui.items[0].sessionId, 'session-alpha')
  assert.equal(ui.label(tree, 'input', '选择会话 session-alpha').props.checked, true)
  assert.ok(ui.nodes(tree, x => x.props?.role === 'alert').length > 0)
})
