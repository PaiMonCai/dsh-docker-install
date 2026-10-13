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
    const documentHandlers = new Map()
    let touchTarget = null
    const document = {
      addEventListener(name, callback) { documentHandlers.set(name, callback) },
      removeEventListener(name) { documentHandlers.delete(name) },
      elementFromPoint() { return touchTarget },
    }
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
    runInNewContext(dockSource, { window, document, console }, { filename: 'dock-client.js' })
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
      setTouchTarget(id, zone) {
        touchTarget = {
          closest() { return this },
          getAttribute(name) {
            return name === 'data-dock-drop' ? id : zone
          },
        }
      },
      fireDocument(name, event) { documentHandlers.get(name)?.(event) },
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
  const grid = app.walk(collapsed, x => x.props?.className === 'dsh-icon-grid')[0]
  assert.ok(grid)
  assert.equal(grid.props.style.gridTemplateColumns, 'repeat(2, minmax(0, 1fr))')
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


const many = count => Array.from({ length: count }, (_, i) =>
  shortcut('fake.item-' + String(i + 1).padStart(2, '0'),
    '测试' + String(i + 1).padStart(2, '0'), i + 1))

test('strict two-row overflow boundaries: 9 stays visible, 10/11 render More as item ten', () => {
  for (const count of [0, 1, 5, 9, 10, 11, 26]) {
    const app = createHarness().page(many(count))
    const wide = app.buttons()
    assert.equal(wide.length, Math.min(count, 9) + (count > 9 ? 1 : 0))
    assert.equal(wide.filter(b => b.props['aria-label'] === '更多').length,
      count > 9 ? 1 : 0)
    if (count >= 10) assert.equal(wide[9].props['aria-label'], '更多')
    const tree = app.render('sidebar.footer.action', { wide: true })
    if (tree !== null) {
      const grid = app.walk(tree, node => node.props?.className === 'dsh-icon-grid')[0]
      assert.equal(grid.props.style.gridTemplateColumns, 'repeat(5, minmax(0, 1fr))')
      assert.equal(grid.props.style.maxHeight, 77)
      assert.ok(app.walk(grid, n => n.type === 'button').length <= 10)
    }
    const narrow = app.render('sidebar.footer.action', { wide: false })
    const narrowButtons = app.walk(narrow, n => n.type === 'button')
    assert.equal(narrowButtons.length,
      Math.min(count, 3) + (count > 3 ? 1 : 0))
    assert.ok(narrowButtons.length <= 4)
    if (count > 3) assert.equal(narrowButtons[3].props['aria-label'], '更多')
    assert.equal(app.dock.getDockLayout(true).more.length, Math.max(0, count - 9))
  }
})

test('More menu opens all overflow items and selecting one preserves its action', () => {
  let called = null
  const entries = many(13)
  entries[12].onClick = () => { called = 'last-item' }
  const app = createHarness().page(entries)
  const trigger = app.buttons()[9]
  assert.equal(trigger.props['aria-label'], '更多')
  assert.equal(trigger.props['aria-expanded'], false)
  trigger.props.onClick()
  const tree = app.render('sidebar.footer.action', { wide: true })
  const menu = app.walk(tree, node => node.props?.role === 'menu')[0]
  assert.ok(menu)
  const options = app.walk(menu, node => node.props?.role === 'menuitem')
  assert.equal(options.length, 4)
  assert.equal(options[3].props.title, '测试13')
  options[3].props.onClick()
  assert.equal(called, 'last-item')
  assert.equal(app.dock.isMoreOpen(), false)
  app.buttons()[9].props.onClick()
  app.fireDocument('pointerdown', { target: { closest() { return null } } })
  assert.equal(app.dock.isMoreOpen(), false)
  app.buttons()[9].props.onClick()
  let prevented = false
  app.fireDocument('keydown', {
    key: 'Escape', preventDefault() { prevented = true },
  })
  assert.equal(app.dock.isMoreOpen(), false)
})

test('editor preview always has 5 columns by 2 rows, with More in slot 10', () => {
  const app = createHarness().page(many(12))
  const editor = app.card()
  const preview = app.walk(editor,
    node => node.props?.className === 'dsh-icon-preview')[0]
  assert.ok(preview)
  const grid = app.walk(preview, node => node.props?.style?.gridTemplateColumns ===
    'repeat(5,minmax(0,1fr))')[0]
  assert.ok(grid)
  assert.equal(grid.props.children.length, 10)
  assert.equal(grid.props.children[9].props['aria-label'], '更多收纳区')
  assert.equal(grid.props.children[9].props['data-dock-zone'], 'more')
  const locations = app.walk(editor, n => n.type === 'select' &&
    n.props?.['aria-label']?.startsWith('显示位置 '))
  assert.equal(locations.length, 12)
  assert.deepEqual(Array.from(locations[0].props.children, n => n.props.value),
    ['dock', 'more', 'hidden'])
})

test('editor mode options distinguish More vs hidden, persist and reclaim shortcut slots', () => {
  const browser = createHarness()
  const app = browser.page(many(11))
  const id = 'fake.item-03'
  const source = app.walk(app.card(), n => n.type === 'select' &&
    n.props?.['aria-label'] === '显示位置 测试03')[0]
  source.props.onChange({ target: { value: 'more' } })
  assert.equal(app.dock.locationOf(id), 'more')
  assert.equal(app.dock.getDockLayout(true).more.some(item => item.id === id), true)
  source.props.onChange({ target: { value: 'hidden' } })
  assert.equal(app.dock.locationOf(id), 'hidden')
  assert.equal(app.buttons().some(b => b.props['aria-label'] === '测试03'), false)
  const afterRefresh = browser.page(many(11))
  assert.equal(afterRefresh.dock.locationOf(id), 'hidden')
  afterRefresh.dock.setLocation(id, 'dock')
  assert.equal(afterRefresh.dock.getDockLayout(true).primary.some(item => item.id === id), true,
    'explicit dock selection must promote entry into first nine icons')
  assert.equal(afterRefresh.buttons().length, 10)
})

test('desktop drag-and-drop moves preview icons; tenth slot sends items to More', () => {
  const app = createHarness().page(many(11))
  let editor = app.card()
  let preview = app.walk(editor, n => n.props?.className === 'dsh-icon-preview')[0]
  let slots = app.walk(preview, n => n.props?.['data-dock-zone'])
  const source = slots.find(n => n.props['data-dock-drop'] === 'fake.item-04')
  const target = slots.find(n => n.props['data-dock-drop'] === 'fake.item-02')
  const data = { effectAllowed: '', setData() {} }
  source.props.onDragStart({ dataTransfer: data })
  assert.equal(data.effectAllowed, 'move')
  let prevented = false
  target.props.onDrop({ preventDefault() { prevented = true } })
  assert.ok(prevented)
  assert.deepEqual(app.buttons().slice(0, 4).map(n => n.props['aria-label']),
    ['测试01', '测试04', '测试02', '测试03'])
  editor = app.card()
  preview = app.walk(editor, n => n.props?.className === 'dsh-icon-preview')[0]
  slots = app.walk(preview, n => n.props?.['data-dock-zone'])
  const dragged = slots.find(n => n.props['data-dock-drop'] === 'fake.item-02')
  const more = slots.find(n => n.props['data-dock-zone'] === 'more')
  dragged.props.onDragStart({ dataTransfer: data })
  more.props.onDrop({ preventDefault() {} })
  assert.equal(app.dock.locationOf('fake.item-02'), 'more')
  assert.ok(app.dock.getDockLayout(true).more.some(n => n.id === 'fake.item-02'))
})

test('touch pointer drag reorders icons with elementFromPoint hit testing', () => {
  const app = createHarness().page(many(5))
  const preview = app.walk(app.card(),
    node => node.props?.className === 'dsh-icon-preview')[0]
  const items = app.walk(preview, n => n.props?.['data-dock-zone'] === 'dock')
  const first = items[0]
  const third = items[2]
  app.setTouchTarget(third.props['data-dock-drop'], 'dock')
  first.props.onPointerDown({
    pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 1,
    currentTarget: { setPointerCapture() {} },
  })
  first.props.onPointerMove({ clientX: 60, clientY: 10 })
  first.props.onPointerUp({ clientX: 60, clientY: 10, preventDefault() {} })
  assert.deepEqual(app.buttons().map(b => b.props['aria-label']),
    ['测试02', '测试01', '测试03', '测试04', '测试05'])
})

test('up/down accessible controls reorder the full list without dragging', () => {
  const app = createHarness().page(many(5))
  const editor = app.card()
  const up = app.walk(editor, n => n.type === 'button' &&
    n.props?.['aria-label'] === '上移 测试02')[0]
  up.props.onClick()
  assert.deepEqual(app.buttons().slice(0, 2).map(n => n.props['aria-label']),
    ['测试02', '测试01'])
  assert.equal(app.dock.getSettings().order[0], 'fake.item-02')
})
