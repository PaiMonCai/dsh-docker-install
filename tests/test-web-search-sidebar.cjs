#!/usr/bin/env node
'use strict'
// Test the injected sidebar footer and overlay without scraping DSH internals.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')

function harness({ searchEnabled = true, managerFirst = false, managerOnline = true,
  managerConfigured = true, managerBusy = false, restartFailure = false, confirmRestart = true } = {}) {
  const source = readFileSync(join(__dirname,
    '../docker/plugins/dsh-web-search/client.js'), 'utf8')
  const managerSource = readFileSync(join(__dirname,
    '../docker/plugins/dsh-session-manager-web/client.js'), 'utf8')
  const dockSource = readFileSync(join(__dirname,
    '../docker/plugins/dsh-icon-dock/client.js'), 'utf8')
  const registered = new Map()
  const injections = []
  const requests = []
  let failNextGet = false
  const keyHandlers = new Map()
  const effects = []
  const frames = new Map()
  let frame
  let cursor = 0
  let moduleDefinition
  let managerDefinition
  let dockDefinition
  const managerSlots = new Map()
  const dockSlots = new Map()
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot() },
    useRef(value) {
      const i = cursor++
      if (!Object.hasOwn(frame.slots, i)) frame.slots[i] = { current: value }
      return frame.slots[i]
    },
    useState(value) {
      const i = cursor++
      const stateSlots = frame.slots
      if (!Object.hasOwn(stateSlots, i)) stateSlots[i] = typeof value === 'function' ? value() : value
      return [stateSlots[i], next => {
        stateSlots[i] = typeof next === 'function' ? next(stateSlots[i]) : next
      }]
    },
    useEffect(callback, next) {
      const i = cursor++
      if (!frame.deps[i] || next.some((v, k) => !Object.is(v, frame.deps[i][k]))) {
        frame.deps[i] = [...next]
        effects.push(callback)
      }
    },
  }
  function render(fn, key = 'card') {
    cursor = 0
    if (!frames.has(key)) frames.set(key, { slots: [], deps: [] })
    frame = frames.get(key)
    const tree = fn()
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  const credentials = {
    describe: async () => ({
      ok: true, value: { BRAVE_SEARCH_API_KEY: { configured: false, writable: true } },
    }),
    set: async () => ({ ok: true }),
    unset: async () => ({ ok: true }),
  }
  const settings = {
    provider: 'searxng', enabled: true, cacheEnabled: true, braveEnabled: false, braveDailyLimit: 0,
  }
  const restartJobs = []
  let restartConfirmations = 0
  const sandbox = {
    crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' },
    window: { confirm() { restartConfirmations++; return confirmRestart },
      __ModuleLoader__: { load(definition) {
      if (definition.id === 'dsh-docker-session-manager') managerDefinition = definition
      else if (definition.id === 'dsh-docker-icon-dock') dockDefinition = definition
      else moduleDefinition = definition
    } } },
    document: {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener(type, handler) { keyHandlers.set(type, handler) },
      removeEventListener(type) { keyHandlers.delete(type) },
    },
    console,
    fetch: async (url, options) => {
      const method = options.method || 'GET'
      const payload = method === 'POST' ? JSON.parse(options.body) : null
      const isManagement = url === '/api/dsh-docker-instance-manager'
      requests.push({ url, method, action: payload?.action || null, settings: payload?.settings,
        payload, headers: options.headers })
      if (isManagement) {
        if (method === 'GET') return {
          ok: true, async json() { return { configured: managerConfigured, online: managerOnline,
            jobs: managerBusy ? [{ state: 'running' }] : restartJobs } },
        }
        if (restartFailure) return {
          ok: false, async json() { return { error: 'host-executor-offline' } },
        }
        restartJobs.push({ id: payload.id, action: payload.action, state: 'queued' })
        return { ok: true, async json() { return { id: payload.id, state: 'queued' } } }
      }
      if (method === 'GET' && failNextGet) {
        failNextGet = false
        return { ok: false, async json() { return { error: '搜索服务暂不可用' } } }
      }
      if (payload?.action === 'save') Object.assign(settings, payload.settings)
      const pendingRestart = settings.provider === 'official' || !settings.enabled
      return {
        ok: true,
        async json() {
          return method === 'POST'
            ? { settings: { ...settings }, running: true, healthy: true, results: 2,
                activeProvider: 'searxng', pendingRestart }
            : { settings: { ...settings }, running: true, activeProvider: 'searxng', pendingRestart }
        },
      }
    },
  }
  runInNewContext(source, sandbox, { filename: 'web-search-client.js' })
  runInNewContext(managerSource, sandbox, { filename: 'session-manager-client.js' })
  runInNewContext(dockSource, sandbox, { filename: 'icon-dock-client.js' })
  function MenuItemButton() {}
  function Modal() {}
  const registry = { inject(name, factory) {
    injections.push(name)
    const values = factory()
    if (values && typeof values.next === 'function') {
      for (const _ of values) {}
    }
  }, register(meta, component) { registered.set(meta.name, { meta, component }) } }
  const managerRegistry = { inject(name, factory) {
    const values = factory()
    if (values && typeof values.next === 'function') {
      for (const _ of values) {}
    }
  }, register(meta, component) { managerSlots.set(meta.name, { meta, component }) } }
  function loadSearch() {
    if (!searchEnabled) return
    const plugin = moduleDefinition.factory(name => {
      if (name === 'react') return React
      throw Error('unexpected dependency ' + name)
    })
    plugin.apply({ slots: registry, remote: { credentials } })
  }
  function loadManager() {
    const plugin = managerDefinition.factory(name => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton, Modal }
      throw Error('unexpected dependency ' + name)
    })
    plugin.apply({ slots: managerRegistry })
  }
  function loadDock() {
    const plugin = dockDefinition.factory(name => {
      if (name === 'react') return React
      throw Error('unexpected dependency ' + name)
    })
    plugin.apply({ slots: {
      inject(name, register) { register() },
      register(meta, component) { dockSlots.set(meta.name, { meta, component }) },
    } })
  }
  if (managerFirst) { loadManager(); loadSearch(); loadDock() }
  else { loadDock(); loadSearch(); loadManager() }
  function nodes(root, predicate, result = []) {
    if (root == null || root === false) return result
    if (Array.isArray(root)) {
      root.forEach(item => nodes(item, predicate, result))
      return result
    }
    if (typeof root !== 'object') return result
    if (predicate(root)) result.push(root)
    nodes(root.props?.children, predicate, result)
    return result
  }
  function text(root) {
    if (root == null || root === false) return ''
    if (typeof root === 'number' || typeof root === 'string') return String(root)
    if (Array.isArray(root)) return root.map(text).join('')
    return text(root.props?.children)
  }
  function footer(wide = true) {
    const component = dockSlots.get('sidebar.footer.action')?.component
    assert.equal(typeof component, 'function')
    return render(() => component({ wide }), 'footer')
  }
  function shortcut(name) {
    const buttons = nodes(footer(), n => n.type === 'button' && n.props?.['aria-label'] === name)
    assert.equal(buttons.length, 1, 'missing shortcut: ' + name)
    return buttons[0]
  }
  function overlay() {
    const host = registered.get('shell.overlay').component()
    return render(() => host.type(host.props), 'overlay')
  }
  function card(tree) {
    const found = nodes(tree, n => typeof n.type === 'function' && n.props?.spacious === true)
    assert.equal(found.length, 1, 'overlay must contain exactly one settings card')
    return found[0]
  }
  async function settle(fn) {
    for (let i = 0; i < 20; i++) await Promise.resolve()
    return render(fn)
  }
  return {
    registered, managerSlots, dockSlots, injections, requests, render, footer, shortcut, overlay, card, nodes, text, settle,
    failNextRefresh() { failNextGet = true }, restartJobs,
    restartConfirmations() { return restartConfirmations },
    keydown(event) { keyHandlers.get('keydown')?.(event) },
  }
}

test('recycle and search icons share exactly one footer row with no visible labels', () => {
  const app = harness()
  assert.ok(app.injections.includes('shell.overlay'))
  assert.ok(app.injections.includes('plugins.item'))
  assert.equal(app.injections.includes('sidebar.footer.action'), false)
  assert.equal(app.registered.get('shell.overlay').meta.id, 'dsh-docker.search-panel')
  assert.equal(app.registered.get('plugins.item').meta.id, 'dsh-docker-web-search')
  const expanded = app.footer(true)
  const collapsed = app.footer(false)
  for (const dock of [expanded, collapsed]) {
    assert.equal(dock.props.role, 'group')
    assert.equal(dock.props.className, 'dsh-icon-dock')
    const buttons = app.nodes(dock, n => n.type === 'button')
    assert.equal(buttons.length, 2)
    assert.deepEqual(buttons.map(n => n.props['aria-label']), ['回收站', '网络搜索'])
    assert.deepEqual(buttons.map(n => n.props.title), ['回收站', '网络搜索'])
    assert.doesNotMatch(app.text(dock), /回收站|网络搜索/)
    assert.equal(buttons[0].props.children[0].type.name, 'SvgIcon')
    assert.equal(buttons[1].props.children[0].type.name, 'SvgIcon')
    const grid = app.nodes(dock, n => n.props?.className === 'dsh-icon-grid')[0]
    assert.ok(grid)
    assert.equal(grid.props.style.display, 'grid')
    assert.equal(grid.props.style.gridTemplateColumns,
      dock === expanded ? 'repeat(5, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))')
  }
})

test('shared footer works with just recycle when optional search is disabled', () => {
  const app = harness({ searchEnabled: false })
  const dock = app.footer(false)
  const buttons = app.nodes(dock, n => n.type === 'button')
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props['aria-label'], '回收站')
  buttons[0].props.onClick()
  const overlay = app.render(() => app.managerSlots.get('shell.overlay').component(), 'trash')
  assert.equal(overlay.props.className, 'dsh-trash-overlay')
})

test('search can register after session footer initialization without losing paired layout', () => {
  const app = harness({ managerFirst: true })
  const dock = app.footer(false)
  assert.equal(app.nodes(dock, n => n.type === 'button').length, 2)
  assert.ok(app.shortcut('网络搜索'))
})

test('search shortcut opens a spacious accessible overlay and both close controls work', () => {
  const app = harness()
  assert.equal(app.overlay(), null)
  app.shortcut('网络搜索').props.onClick()
  let panel = app.overlay()
  assert.equal(panel.props.className, 'dsh-search-overlay')
  assert.equal(app.nodes(panel, n => n.props?.role === 'dialog'
    && n.props?.['aria-modal'] === 'true').length, 1)
  assert.match(app.nodes(panel, n => n.type === 'style')[0].props.children[0],
    /width:min\(820px,96vw\)/)
  assert.equal(app.card(panel).props.remote.describe instanceof Function, true)
  const close = app.nodes(panel, n => n.type === 'button'
    && n.props?.['aria-label'] === '关闭网络搜索')[0]
  assert.ok(close)
  close.props.onClick()
  assert.equal(app.overlay(), null)
  app.shortcut('网络搜索').props.onClick()
  panel = app.overlay()
  panel.props.onMouseDown({ target: panel, currentTarget: panel })
  assert.equal(app.overlay(), null)
})

test('opened settings reuse existing authenticated API and Brave controls', async () => {
  const app = harness()
  app.shortcut('网络搜索').props.onClick()
  const panel = app.overlay()
  const settingsView = app.card(panel)
  let tree = app.render(() => settingsView.type(settingsView.props))
  tree = await app.settle(() => settingsView.type(settingsView.props))
  assert.match(app.text(tree), /SearXNG/)
  assert.match(app.text(tree), /搜索与缓存/)
  assert.match(app.text(tree), /Brave API Key/)
  const testButton = app.nodes(tree, n => n.type === 'button'
    && app.text(n) === '测试搜索')[0]
  assert.ok(testButton && !testButton.props.disabled)
  testButton.props.onClick()
  tree = await app.settle(() => settingsView.type(settingsView.props))
  assert.match(app.text(tree), /搜索正常：找到 2 条结果/)
  assert.deepEqual(app.requests.map(x => x.method), ['GET', 'POST'])
  assert.deepEqual(app.requests.map(x => x.action), [null, 'test'])
})

test('plugin summary view remains available without querying search backend or credentials', async () => {
  const app = harness()
  const item = app.registered.get('plugins.item').component({ view: 'summary' })
  const view = app.render(() => item.type(item.props), 'summary')
  assert.match(view, /内置 SearXNG/)
  await app.settle(() => item.type(item.props))
  assert.equal(app.requests.length, 0, 'summary rows should not trigger network requests')
})

test('Refresh reports server errors in the panel and does not create unhandled rejection', async () => {
  const app = harness()
  app.shortcut('网络搜索').props.onClick()
  const panel = app.overlay()
  const view = app.card(panel)
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  app.failNextRefresh()
  const refresh = app.nodes(tree, n => n.type === 'button' && app.text(n) === '刷新')[0]
  refresh.props.onClick()
  tree = await app.settle(() => view.type(view.props))
  assert.match(app.text(tree), /搜索服务暂不可用/)
  assert.equal(app.requests.filter(row => row.method === 'GET').length, 2)
})

test('Escape closes the search overlay', () => {
  const app = harness()
  app.shortcut('网络搜索').props.onClick()
  const panel = app.overlay()
  assert.equal(panel.props.className, 'dsh-search-overlay')
  let prevented = false
  app.keydown({ key: 'Escape', preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(app.overlay(), null)
})

test('provider selector saves official mode and clearly requires DSH restart', async () => {
  const app = harness()
  app.shortcut('网络搜索').props.onClick()
  const view = app.card(app.overlay())
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  const select = app.nodes(tree, n => n.type === 'select'
    && n.props?.['aria-label'] === '搜索提供方')[0]
  assert.ok(select)
  assert.equal(select.props.value, 'searxng')
  select.props.onChange({ target: { value: 'official' } })
  tree = app.render(() => view.type(view.props))
  const updated = app.nodes(tree, n => n.type === 'select'
    && n.props?.['aria-label'] === '搜索提供方')[0]
  assert.equal(updated.props.value, 'official')
  const save = app.nodes(tree, n => n.type === 'button' && app.text(n) === '仅保存设置')[0]
  save.props.onClick()
  tree = await app.settle(() => view.type(view.props))
  assert.equal(app.requests.at(-1).settings.provider, 'official')
  assert.match(app.text(tree), /待生效的切换/)
  assert.match(app.text(tree), /dshd search restart/)
  const testSearch = app.nodes(tree, n => n.type === 'button' && app.text(n) === '测试搜索')[0]
  assert.equal(testSearch.props.disabled, false, 'current SearXNG stays live until restart')
})

test('save and apply switches provider from Web via authenticated host bridge', async () => {
  const app = harness()
  app.shortcut('网络搜索').props.onClick()
  const view = app.card(app.overlay())
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  const select = app.nodes(tree, n => n.type === 'select'
    && n.props?.['aria-label'] === '搜索提供方')[0]
  select.props.onChange({ target: { value: 'official' } })
  tree = app.render(() => view.type(view.props))
  const apply = app.nodes(tree, n => n.type === 'button' && app.text(n) === '保存并应用')[0]
  assert.ok(apply)
  apply.props.onClick()
  tree = await app.settle(() => view.type(view.props))
  assert.equal(app.restartConfirmations(), 1)
  assert.deepEqual(app.requests.map(r => r.url), [
    '/api/dsh-docker-web-search',
    '/api/dsh-docker-instance-manager',
    '/api/dsh-docker-web-search',
    '/api/dsh-docker-instance-manager',
  ])
  const restart = app.requests.at(-1)
  assert.equal(restart.payload.action, 'restart')
  assert.equal(restart.headers['x-dsh-management'], '1')
  assert.equal(restart.payload.id, '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(restart.payload.arguments && Object.keys(restart.payload.arguments).length, 0)
  assert.equal(app.requests.at(-2).settings.provider, 'official')
  assert.match(app.text(tree), /已提交 DSH 重启任务/)
})

test('Web apply refuses if host manager is offline without changing provider preferences', async () => {
  const app = harness({ managerOnline: false })
  app.shortcut('网络搜索').props.onClick()
  const view = app.card(app.overlay())
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  app.nodes(tree, n => n.type === 'select' && n.props?.['aria-label'] === '搜索提供方')[0]
    .props.onChange({ target: { value: 'official' } })
  tree = app.render(() => view.type(view.props))
  app.nodes(tree, n => n.type === 'button' && app.text(n) === '保存并应用')[0].props.onClick()
  tree = await app.settle(() => view.type(view.props))
  assert.match(app.text(tree), /宿主机实例管理服务离线/)
  assert.equal(app.requests.filter(r => r.action === 'save').length, 0)
  assert.equal(app.restartJobs.length, 0)
})

test('user can decline restart without saving any settings', async () => {
  const app = harness({ confirmRestart: false })
  app.shortcut('网络搜索').props.onClick()
  const view = app.card(app.overlay())
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  app.nodes(tree, n => n.type === 'button' && app.text(n) === '保存并应用')[0].props.onClick()
  await app.settle(() => view.type(view.props))
  assert.equal(app.restartConfirmations(), 1)
  assert.equal(app.requests.length, 1)
})

test('manager restart refusal never falsely claims the provider was applied', async () => {
  const app = harness({ restartFailure: true })
  app.shortcut('网络搜索').props.onClick()
  const view = app.card(app.overlay())
  let tree = app.render(() => view.type(view.props))
  tree = await app.settle(() => view.type(view.props))
  app.nodes(tree, n => n.type === 'select' && n.props?.['aria-label'] === '搜索提供方')[0]
    .props.onChange({ target: { value: 'official' } })
  tree = app.render(() => view.type(view.props))
  app.nodes(tree, n => n.type === 'button' && app.text(n) === '保存并应用')[0].props.onClick()
  tree = await app.settle(() => view.type(view.props))
  assert.match(app.text(tree), /重启任务结果尚未确认/)
  assert.match(app.text(tree), /待生效的切换/)
  assert.equal(app.restartJobs.length, 0)
})
