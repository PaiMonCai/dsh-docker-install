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
const dockSource = fs.readFileSync(path.join(__dirname,
  '../docker/plugins/dsh-icon-dock/client.js'), 'utf8')

const daysAgo = days => new Date(Date.now() - days * 86400000).toISOString()
const seeds = () => [
  { sessionId: 'session-alpha', title: '市场分析', deletedAt: daysAgo(1) },
  { sessionId: 'session-beta', title: '数学笔记', deletedAt: daysAgo(15) },
  { sessionId: 'session-gamma', title: '经济学', deletedAt: daysAgo(3) },
]

function harness(input = seeds(), reject = new Set()) {
  let definition
  let dockDefinition
  const slots = new Map()
  const entries = new Map()
  let items = structuredClone(input)
  const mutations = []
  let cursor = 0
  const states = []
  const deps = []
  const effects = []
  let visibleRows = []
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
    querySelectorAll(selector) {
      assert.equal(selector, '.dsh-session-select')
      return visibleRows.map(row => ({
        disabled: row.disabled || false,
        dataset: { sessionId: row.sessionId, sessionTitle: row.title || row.sessionId },
        getClientRects() { return row.hidden ? [] : [{}] },
      }))
    },
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
    if (body.action === 'trash' && !items.some(row => row.sessionId === body.sessionId)) {
      items.push({ sessionId: body.sessionId, title: body.title, deletedAt: daysAgo(0) })
    }
    return { ok: true, async json() { return { success: true } } }
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: plugin => {
      if (plugin.id === 'dsh-docker-icon-dock') dockDefinition = plugin
      else definition = plugin
    } } },
    document, fetch, console,
    setTimeout() { return 1 }, clearTimeout() {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'session-manager-client.js' })
  vm.runInNewContext(dockSource, sandbox, { filename: 'icon-dock-client.js' })
  assert.equal(definition.id, 'dsh-docker-session-manager')
  function Modal() {}
  function MenuItemButton() {}
  const plugin = definition.factory(name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Modal, MenuItemButton }
    throw Error('unexpected require ' + name)
  })
  const registry = { slots: {
    inject(name, factory) {
      const values = factory()
      if (values && typeof values.next === 'function') for (const _ of values) {}
    },
    register(props, component) {
      slots.set(props.name, component)
      entries.set(props.id, component)
    },
  } }
  // Register the contributor first to verify descriptor queuing and
  // independent dock ownership when startup order varies.
  plugin.apply(registry)
  const dock = dockDefinition.factory(name => {
    assert.equal(name, 'react')
    return React
  })
  dock.apply(registry)
  const Footer = slots.get('sidebar.footer.action')
  const Dialog = slots.get('shell.overlay')
  const Checkbox = slots.get('sidebar.workspaces.session.row.action')
  const Toolbar = entries.get('dsh-docker.session-batch')
  assert.equal(typeof Footer, 'function')
  assert.equal(typeof Dialog, 'function')
  assert.equal(typeof Checkbox, 'function')
  assert.equal(typeof Toolbar, 'function')

  function render() {
    cursor = 0
    const tree = Dialog()
    for (const fn of effects.splice(0)) fn()
    return tree
  }
  async function settle() {
    for (let i = 0; i < 80; i++) await Promise.resolve()
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
    const buttons = nodes(Footer({ wide: true }), node =>
      node.type === 'button' && node.props?.['aria-label'] === '回收站')
    assert.equal(buttons.length, 1)
    buttons[0].props.onClick()
    render()
    return settle()
  }
  return {
    open, render, settle, nodes, label, named, textOf, Modal,
    checkbox(id, title = id) {
      cursor = 0
      return Checkbox({ sessionId: id, displayTitle: title })
    },
    toolbar() { cursor = 0; return Toolbar() },
    setVisibleRows(rows) { visibleRows = rows },
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
  ui.label(tree, 'select', '排序方式').props.onChange({ target: { value: 'oldest' } })
  tree = ui.render()
  assert.match(ui.textOf(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row')[0]), /经济学/)
  ui.label(tree, 'select', '排序方式').props.onChange({ target: { value: 'newest' } })
  tree = ui.render()
  ui.label(tree, 'input', '选择当前结果').props.onChange({ target: { checked: true } })
  tree = ui.render()
  assert.match(ui.textOf(tree), /已选择\s*2/)
  ui.named(tree, 'button', '恢复选中').props.onClick()
  tree = await ui.settle()
  tree = await ui.settle()
  assert.deepEqual(ui.mutations.filter(x => x.action === 'restore')
    .map(x => x.sessionId), ['session-alpha', 'session-gamma'])
  assert.deepEqual(ui.items.map(x => x.sessionId), ['session-beta'])
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 0)
  ui.named(tree, 'button', '清除筛选').props.onClick()
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 1)
})

test('bulk permanent deletion immediately deletes only selected items, without confirmation', async () => {
  const ui = harness()
  let tree = await ui.open()
  ui.label(tree, 'input', '选择会话 session-alpha')
    .props.onChange({ target: { checked: true } })
  ui.label(tree, 'input', '选择会话 session-gamma')
    .props.onChange({ target: { checked: true } })
  tree = ui.render()
  ui.named(tree, 'button', '永久删除选中').props.onClick()
  tree = ui.render()
  assert.equal(ui.nodes(tree, n => n.type === ui.Modal).length, 0)
  assert.equal(ui.nodes(tree, n => n.type === 'input' && n.props.type === 'text').length, 0)
  await ui.settle()
  tree = await ui.settle()
  assert.equal(ui.items.length, 1)
  assert.equal(ui.items[0].sessionId, 'session-beta')
  assert.equal(ui.mutations.filter(x => x.action === 'purge').length, 2)
})

test('single permanent deletion runs immediately and duplicate clicks are ignored', async () => {
  const ui = harness([seeds()[0]])
  let tree = await ui.open()
  const erase = ui.named(tree, 'button', '永久删除')
  erase.props.onClick()
  erase.props.onClick()
  tree = await ui.settle()
  assert.equal(ui.items.length, 0)
  assert.equal(ui.mutations.length, 1)
  assert.equal(ui.mutations[0].action, 'purge')
  assert.equal(ui.nodes(tree, n => n.type === ui.Modal).length, 0)
})

test('session-row checkboxes do not open or drag rows and support deselection', () => {
  const ui = harness([])
  let checkbox = ui.checkbox('session-alpha', '市场分析')
  assert.equal(checkbox.type, 'input')
  assert.equal(checkbox.props.type, 'checkbox')
  assert.equal(checkbox.props.checked, false)
  let stopped = 0
  const event = { key: ' ', stopPropagation() { stopped++ } }
  for (const name of ['onClick', 'onDoubleClick', 'onPointerDown', 'onKeyDown']) {
    checkbox.props[name](event)
  }
  assert.equal(stopped, 4)
  checkbox.props.onChange({ target: { checked: true } })
  checkbox = ui.checkbox('session-alpha')
  assert.equal(checkbox.props.checked, true)
  assert.match(ui.textOf(ui.toolbar()), /已选择 1/)
  checkbox.props.onChange({ target: { checked: false } })
  assert.equal(ui.checkbox('session-alpha').props.checked, false)
  assert.equal(ui.nodes(ui.toolbar(), n => n.props?.className === 'dsh-session-batch').length, 0)
})

test('select current list excludes hidden rows and batch trash preserves session titles', async () => {
  const ui = harness([])
  ui.checkbox('session-alpha', '市场分析').props.onChange({ target: { checked: true } })
  ui.setVisibleRows([
    { sessionId: 'session-alpha', title: '市场分析' },
    { sessionId: 'session-beta', title: '数学笔记' },
    { sessionId: 'session-hidden', title: '不可见会话', hidden: true },
  ])
  let tree = ui.toolbar()
  ui.named(tree, 'button', '选择当前列表').props.onClick()
  tree = ui.toolbar()
  assert.match(ui.textOf(tree), /已选择 2/)
  const submit = ui.named(tree, 'button', '移入回收站')
  submit.props.onClick()
  submit.props.onClick()
  assert.equal(ui.checkbox('session-beta').props.disabled, true)
  assert.equal(ui.named(ui.toolbar(), 'button', '清空选择').props.disabled, true)
  await ui.settle()
  assert.deepEqual(ui.mutations, [
    { action: 'trash', sessionId: 'session-alpha', title: '市场分析' },
    { action: 'trash', sessionId: 'session-beta', title: '数学笔记' },
  ])
  assert.equal(ui.checkbox('session-alpha').props.checked, false)
  assert.match(ui.textOf(ui.toolbar()), /已移入回收站 2 \/ 2/)
  tree = await ui.open()
  assert.equal(ui.nodes(tree, n => n.props?.className === 'dsh-trash-row').length, 2)
})

test('partial batch trash keeps failed rows selected and permits retry', async () => {
  const failed = new Set(['session-beta'])
  const ui = harness([], failed)
  for (const id of ['session-alpha', 'session-beta', 'session-gamma']) {
    ui.checkbox(id).props.onChange({ target: { checked: true } })
  }
  ui.named(ui.toolbar(), 'button', '移入回收站').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations.length, 3)
  assert.equal(ui.checkbox('session-alpha').props.checked, false)
  assert.equal(ui.checkbox('session-beta').props.checked, true)
  assert.equal(ui.checkbox('session-gamma').props.checked, false)
  assert.match(ui.textOf(ui.toolbar()), /项失败 1/)
  failed.clear()
  ui.named(ui.toolbar(), 'button', '移入回收站').props.onClick()
  await ui.settle()
  assert.deepEqual(ui.mutations.slice(3).map(row => row.sessionId), ['session-beta'])
  assert.equal(ui.checkbox('session-beta').props.checked, false)
})

test('long session titles respect the API length limit during batch trash', async () => {
  const ui = harness([])
  ui.checkbox('session-alpha', '长'.repeat(200)).props.onChange({ target: { checked: true } })
  ui.named(ui.toolbar(), 'button', '移入回收站').props.onClick()
  await ui.settle()
  assert.equal(ui.mutations[0].title.length, 160)
})

test('partial permanent deletion retains failed items selected without adding a confirmation', async () => {
  const ui = harness(seeds(), new Set(['session-alpha']))
  let tree = await ui.open()
  ui.label(tree, 'input', '选择当前结果').props.onChange({ target: { checked: true } })
  tree = ui.render()
  ui.named(tree, 'button', '永久删除选中').props.onClick()
  tree = await ui.settle()
  assert.deepEqual(ui.items.map(row => row.sessionId), ['session-alpha'])
  assert.equal(ui.label(tree, 'input', '选择会话 session-alpha').props.checked, true)
  assert.equal(ui.nodes(tree, n => n.type === ui.Modal).length, 0)
})

test('failed batch restore leaves failures in trash and still restores remaining', async () => {
  const ui = harness(seeds(), new Set(['session-alpha']))
  let tree = await ui.open()
  ui.label(tree, 'input', '选择当前结果').props.onChange({ target: { checked: true } })
  tree = ui.render()
  ui.named(tree, 'button', '恢复选中').props.onClick()
  tree = await ui.settle()
  tree = await ui.settle()
  assert.equal(ui.items.length, 1)
  assert.equal(ui.items[0].sessionId, 'session-alpha')
  assert.equal(ui.label(tree, 'input', '选择会话 session-alpha').props.checked, true)
  assert.ok(ui.nodes(tree, x => x.props?.role === 'alert').length > 0)
})

test('recycle bin remains icon-only and functional when search plugin is disabled', async () => {
  const ui = harness()
  const tree = await ui.open()
  assert.equal(tree.props.className, 'dsh-trash-overlay')
  // Search plugin is intentionally absent from this test sandbox.
  const source = fs.readFileSync(path.join(__dirname,
    '../docker/plugins/dsh-session-manager-web/client.js'), 'utf8')
  assert.match(source, /id: 'dsh-docker.session-recycle'/)
  assert.doesNotMatch(source, /sidebar\.footer\.action/)
  assert.match(dockSource, /className: 'dsh-icon-dock'/)
})
