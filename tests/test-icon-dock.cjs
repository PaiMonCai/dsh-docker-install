#!/usr/bin/env node
'use strict'
// The dock must be usable before/after contributor registration, survive
// browser refresh, and not depend on either optional extension.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const dockSource = readFileSync(join(__dirname,
  '../docker/plugins/dsh-icon-dock/client.js'), 'utf8')

function createHarness(initial = new Map()) {
  const records = new Map(initial)
  const windows = []
  function page(before = [], panelInput = []) {
    let plugin
    const slots = new Map()
    const panels = [...panelInput]
    const panelListeners = new Set()
    const selectedPanels = []
    const activeListeners = new Set()
    let activePanelId = null
    let cursor = 0
    let key = 'dock'
    const storage = {
      getItem(id) { return records.has(id) ? records.get(id) : null },
      setItem(id, text) { records.set(id, String(text)) },
    }
    const window = { localStorage: storage, addEventListener() {},
      __ModuleLoader__: { load(value) { plugin = value } },
      __dshDockerIconDockPendingV1: before,
    }
    windows.push(window)
    const React = {
      createElement(type, props, ...children) { return { type, props: { ...props, children } } },
      useSyncExternalStore(_, get) { cursor++; return get() },
    }
    runInNewContext(dockSource, { window, console }, { filename: 'dock-client.js' })
    const manager = plugin.factory(name => {
      assert.equal(name, 'react')
      return React
    })
    manager.apply({
      layout: {
        selectPanel(id) {
          selectedPanels.push(id)
          activePanelId = id
          for (const cb of activeListeners) cb()
        },
        panelInfo: {
          getSnapshot() { return { activePanelId } },
          subscribe(fn) { activeListeners.add(fn); return () => activeListeners.delete(fn) },
        },
      },
      locale: { subscribe() { return () => {} } },
      slots: {
        inject(slot, cb) { cb() },
        register(meta, component) { slots.set(meta.name, { meta, component }) },
        entriesOfSlot(name) {
          assert.equal(name, 'sidebar.panellist')
          return panels.map(item => ({
            options: { id: item.id, label: item.label, order: item.order },
            component: item.component, inject: item.inject, store: item.store,
            locale: item.locale, children: item.children,
          }))
        },
        subscribe(name, cb) {
          assert.equal(name, 'sidebar.panellist')
          panelListeners.add(cb)
          return () => panelListeners.delete(cb)
        },
      },
    })
    function render(name, props) {
      cursor = 0
      key = name
      const comp = slots.get(name)?.component
      assert.equal(typeof comp, 'function', 'missing ' + name)
      return comp(props || {})
    }
    function walk(root, testNode, out = []) {
      if (root == null || root === false) return out
      if (Array.isArray(root)) {
        root.forEach(item => walk(item, testNode, out))
        return out
      }
      if (typeof root !== 'object') return out
      if (testNode(root)) out.push(root)
      walk(root.props?.children, testNode, out)
      return out
    }
    const dock = window.__dshDockerIconDockV1
    const buttons = () => walk(render('sidebar.footer.action', { wide: true }),
      item => item.type === 'button')
    const card = () => render('plugins.item', { view: 'settings' })
    return {
      window, dock, buttons, card, walk, slots, render, records, selectedPanels,
      updatePanels(rows) {
        panels.splice(0, panels.length, ...rows)
        for (const callback of panelListeners) callback()
      },
      css() {
        const tree = render('sidebar.footer.action', { wide: true })
        return walk(tree, x => x.type === 'style').map(x => x.props.children[0]).join('')
      },
    }
  }
  return { page, records }
}
const shortcut = (id, label, order, icon = 'grid', action = () => {}) =>
  ({ id, label, order, icon, onClick: action })
const recycle = () => shortcut('dsh-docker.session-recycle', '回收站', 100, 'trash')
const search = () => shortcut('dsh-docker.web-search', '网络搜索', 200, 'search')

test('standalone dock provides one footer slot and independent plugin settings entry', () => {
  const app = createHarness().page()
  assert.equal(app.slots.get('sidebar.footer.action').meta.id, 'dsh-docker.icon-dock')
  assert.equal(app.slots.get('plugins.item').meta.id, 'dsh-docker.icon-dock-settings')
  assert.equal(app.render('plugins.item', { view: 'summary' }).includes('统一管理'), true)
  assert.equal(app.render('sidebar.footer.action'), null, 'empty dock should not add placeholder')
})

test('contributors can register before or after dock initialization', () => {
  const early = createHarness().page([recycle(), search()])
  assert.deepEqual(early.buttons().map(x => x.props['aria-label']), ['回收站', '网络搜索'])
  assert.equal(early.window.__dshDockerIconDockPendingV1.length, 0)
  const late = createHarness().page()
  late.dock.register(search())
  late.dock.register(recycle())
  assert.deepEqual(late.buttons().map(x => x.props['aria-label']), ['回收站', '网络搜索'])
  assert.equal(late.dock.register({ id: '../hack', label: 'bad', onClick() {} }), false)
  assert.equal(late.buttons().length, 2)
})

test('visibility settings remove buttons without disabling registered plugin callbacks', () => {
  let hits = 0
  const a = createHarness().page()
  a.dock.register(recycle())
  a.dock.register(shortcut('dsh-docker.web-search', '网络搜索', 200, 'search', () => { hits++ }))
  assert.equal(a.buttons().length, 2)
  a.dock.setVisible('dsh-docker.web-search', false)
  assert.deepEqual(a.buttons().map(n => n.props['aria-label']), ['回收站'])
  assert.equal(a.dock.getAll().length, 2)
  a.dock.setVisible('dsh-docker.web-search', true)
  a.buttons()[1].props.onClick()
  assert.equal(hits, 1)
})

test('manager card toggles visibility, moves icons and persists per browser', () => {
  const browser = createHarness()
  const a = browser.page([recycle(), search()])
  const settings = a.card()
  const checkbox = a.walk(settings, item => item.type === 'input' &&
    item.props['aria-label'] === '显示 回收站')[0]
  assert.ok(checkbox && checkbox.props.checked)
  checkbox.props.onChange({ target: { checked: false } })
  assert.deepEqual(a.buttons().map(x => x.props['aria-label']), ['网络搜索'])
  const stored = JSON.parse(browser.records.get('dsh-docker-icon-dock:v1'))
  assert.equal(stored.hidden['dsh-docker.session-recycle'], true)
  a.dock.move('dsh-docker.web-search', -1)
  a.dock.setSize(24)
  const second = browser.page([recycle(), search()])
  assert.deepEqual(second.buttons().map(x => x.props['aria-label']), ['网络搜索'])
  assert.deepEqual(Array.from(second.dock.getAll(), x => x.id),
    ['dsh-docker.web-search', 'dsh-docker.session-recycle'])
  assert.equal(second.dock.getSettings().size, 24)
  second.dock.reset()
  assert.deepEqual(second.buttons().map(x => x.props['aria-label']), ['回收站', '网络搜索'])
  assert.equal(second.dock.getSettings().size, 20)
})

test('future plugins can add icon callbacks or custom React icons without modifying the manager', () => {
  const app = createHarness().page([recycle()])
  let hit = 0
  app.dock.register(shortcut('third-party.tools', '扩展工具', 300, 'terminal', () => hit++))
  app.dock.register({
    id: 'third-party.custom', label: '自定义', order: 400,
    onClick() { hit++ },
    renderIcon({ size, h }) { return h('svg', { width: size, height: size }) },
  })
  assert.deepEqual(app.buttons().map(n => n.props['aria-label']),
    ['回收站', '扩展工具', '自定义'])
  app.buttons()[1].props.onClick()
  app.buttons()[2].props.onClick()
  assert.equal(hit, 2)
  app.dock.unregister('third-party.tools')
  assert.equal(app.buttons().length, 2)
})

test('corrupted localStorage does not block the UI', () => {
  const browser = createHarness(new Map([['dsh-docker-icon-dock:v1', '{not-json']]))
  const app = browser.page([recycle()])
  assert.equal(app.buttons().length, 1)
  assert.equal(app.dock.getSettings().size, 20)
})

test('official panel list is mirrored and clicking a dock icon uses native layout navigation', () => {
  const panels = [
    { id: 'plugins', order: 0, label: () => '插件' },
    { id: 'schedules', order: 10, label: () => '自动化任务' },
    { id: 'context-insights', order: 20, label: () => '上下文洞察' },
  ]
  const app = createHarness().page([recycle(), search()], panels)
  assert.deepEqual(app.buttons().map(x => x.props['aria-label']),
    ['插件', '自动化任务', '上下文洞察', '回收站', '网络搜索'])
  assert.match(app.css(), /nav\[class\*="panelList"\]\{display:none!important\}/)
  app.buttons()[0].props.onClick()
  app.buttons()[1].props.onClick()
  app.buttons()[2].props.onClick()
  assert.deepEqual(app.selectedPanels, ['plugins', 'schedules', 'context-insights'])
  assert.equal(app.dock.getNativeCount(), 3)
  assert.equal(app.buttons()[2].props['aria-current'], 'page')
  assert.equal(app.buttons()[0].props['aria-current'], undefined)
  const collapsed = app.render('sidebar.footer.action', { wide: false })
  assert.equal(collapsed.props.style.width, '36px')
  assert.equal(collapsed.props.style.flexWrap, 'wrap')
})

test('native panel discovery follows additions and removals without restarting dock', () => {
  const app = createHarness().page([recycle()],
    [{ id: 'plugins', order: 0, label: '插件' }])
  app.updatePanels([
    { id: 'plugins', order: 0, label: '插件' },
    { id: 'schedules', order: 10, label: '自动化任务' },
  ])
  assert.deepEqual(app.buttons().map(x => x.props['aria-label']),
    ['插件', '自动化任务', '回收站'])
  app.updatePanels([{ id: 'schedules', order: 10, label: '自动化任务' }])
  assert.deepEqual(app.buttons().map(x => x.props['aria-label']),
    ['自动化任务', '回收站'])
})

test('capture toggle restores original official sidebar; preference persists across reloads', () => {
  const browser = createHarness()
  const native = [{ id: 'plugins', order: 0, label: '插件' }]
  const app = browser.page([recycle()], native)
  assert.match(app.css(), /nav\[class\*="panelList"\]/)
  const toggle = app.walk(app.card(), x => x.type === 'input' &&
    x.props?.['aria-label'] === '接管官方导航')[0]
  assert.ok(toggle && toggle.props.checked)
  toggle.props.onChange({ target: { checked: false } })
  assert.deepEqual(app.buttons().map(x => x.props['aria-label']), ['回收站'])
  assert.doesNotMatch(app.css(), /nav\[class\*="panelList"\]/)
  const otherPage = browser.page([recycle()], native)
  assert.deepEqual(otherPage.buttons().map(x => x.props['aria-label']), ['回收站'])
  assert.equal(otherPage.dock.getSettings().captureNative, false)
  otherPage.dock.reset()
  assert.deepEqual(otherPage.buttons().map(x => x.props['aria-label']), ['插件', '回收站'])
})

test('unsafe or unsupported native panel id never hides original navigation', () => {
  const app = createHarness().page([recycle()], [
    { id: 'plugins', label: '插件', order: 0 },
    { id: '../unknown', label: '未支持的面板', order: 2 },
  ])
  assert.deepEqual(app.buttons().map(x => x.props['aria-label']), ['插件', '回收站'])
  assert.doesNotMatch(app.css(), /nav\[class\*="panelList"\]/)
  assert.equal(app.dock.getNativeCaptured(), false)
})


test('official icons inherit the exact upstream React component and forwarded size', () => {
  function OfficialPluginIcon(props) { return { source: 'official', ...props } }
  function OfficialClockIcon(props) { return { source: 'clock', ...props } }
  const app = createHarness().page([], [
    { id: 'plugins', label: '插件', order: 0, component: OfficialPluginIcon },
    { id: 'schedules', label: '自动化任务', order: 10, component: OfficialClockIcon },
  ])
  const buttons = app.buttons()
  assert.equal(buttons.length, 2)
  const nativePlugin = buttons[0].props.children[0]
  const nativeSchedule = buttons[1].props.children[0]
  assert.equal(nativePlugin.type.name, 'SvgIcon')
  // Calling this pure wrapper simulates React rendering its child;
  // official components themselves must remain uncalled by the manager.
  const pluginNode = nativePlugin.type(nativePlugin.props)
  const scheduleNode = nativeSchedule.type(nativeSchedule.props)
  assert.strictEqual(pluginNode.type, OfficialPluginIcon)
  assert.strictEqual(scheduleNode.type, OfficialClockIcon)
  assert.equal(pluginNode.props.size, 20)
  assert.equal(pluginNode.props.active, false)
  assert.equal(scheduleNode.props.size, 20)
  buttons[0].props.onClick()
  const current = app.buttons()[0]
  const selectedNode = current.props.children[0].type(current.props.children[0].props)
  assert.strictEqual(selectedNode.type, OfficialPluginIcon)
  assert.equal(selectedNode.props.active, true)
  assert.equal(current.props['aria-current'], 'page')
})

test('hot-swapped native icon is reflected by the dock without cloning SVG', () => {
  const OldIcon = () => null
  const NewIcon = () => null
  const app = createHarness().page([], [
    { id: 'plugins', label: '插件', order: 0, component: OldIcon },
  ])
  let icon = app.buttons()[0].props.children[0]
  assert.strictEqual(icon.type(icon.props).type, OldIcon)
  app.updatePanels([
    { id: 'plugins', label: '插件', order: 0, component: NewIcon },
  ])
  icon = app.buttons()[0].props.children[0]
  assert.strictEqual(icon.type(icon.props).type, NewIcon)
})

test('native icon with framework-injected props uses fallback, preserving navigation', () => {
  function NeedsFrameworkProps() { throw Error('must not run without injected props') }
  const app = createHarness().page([], [
    { id: 'plugins', label: '插件', order: 0, component: NeedsFrameworkProps,
      inject: () => ({ special: true }) },
  ])
  const button = app.buttons()[0]
  const wrapper = button.props.children[0]
  const rendered = wrapper.type(wrapper.props)
  assert.equal(rendered.type, 'svg')
  assert.equal(rendered.props.children.length, 4, 'grid fallback instead of plugin icon')
  button.props.onClick()
  assert.deepEqual(app.selectedPanels, ['plugins'])
  assert.equal(app.dock.getNativeCaptured(), true)
})

test('future extension renderIcon overrides default glyph without losing dock controls', () => {
  const app = createHarness().page()
  const custom = ({ size, h }) => h('svg', { id: 'provider-native', width: size, height: size })
  app.dock.register({ id: 'custom.tool', label: '自带图标', order: 100,
    icon: 'grid', renderIcon: custom, onClick() {} })
  const button = app.buttons()[0]
  const icon = button.props.children[0].type(button.props.children[0].props)
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.id, 'provider-native')
  assert.equal(icon.props.width, 20)
  app.dock.setSize(24)
  const changed = app.buttons()[0].props.children[0].type(app.buttons()[0].props.children[0].props)
  assert.equal(changed.props.width, 24)
})
