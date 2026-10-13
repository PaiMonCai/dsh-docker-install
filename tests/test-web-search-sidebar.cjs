#!/usr/bin/env node
'use strict'
// Test the injected sidebar footer and overlay without scraping DSH internals.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')

function harness() {
  const source = readFileSync(join(__dirname,
    '../docker/plugins/dsh-web-search/client.js'), 'utf8')
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
    enabled: true, cacheEnabled: true, braveEnabled: false, braveDailyLimit: 0,
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { moduleDefinition = definition } } },
    document: {
      activeElement: null,
      body: { style: { overflow: '' } },
      addEventListener(type, handler) { keyHandlers.set(type, handler) },
      removeEventListener(type) { keyHandlers.delete(type) },
    },
    console,
    fetch: async (_url, options) => {
      const method = options.method
      requests.push({ method, action: method === 'POST' ? JSON.parse(options.body).action : null })
      if (method === 'GET' && failNextGet) {
        failNextGet = false
        return { ok: false, async json() { return { error: '搜索服务暂不可用' } } }
      }
      return {
        ok: true,
        async json() {
          return method === 'POST'
            ? { settings, running: true, healthy: true, results: 2 }
            : { settings, running: true }
        },
      }
    },
  }
  runInNewContext(source, sandbox, { filename: 'web-search-client.js' })
  const plugin = moduleDefinition.factory(name => {
    if (name === 'react') return React
    throw Error('unexpected dependency ' + name)
  })
  plugin.apply({ slots: {
    inject(name, apply) {
      injections.push(name)
      apply()
    },
    register(meta, component) { registered.set(meta.name, { meta, component }) },
  }, remote: { credentials } })
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
    registered, injections, requests, render, overlay, card, nodes, text, settle,
    failNextRefresh() { failNextGet = true },
    keydown(event) { keyHandlers.get('keydown')?.(event) },
  }
}

test('search shortcut registers beside recycle bin and retains the plugin settings view', () => {
  const app = harness()
  assert.ok(app.injections.includes('sidebar.footer.action'))
  assert.ok(app.injections.includes('shell.overlay'))
  assert.ok(app.injections.includes('plugins.item'))
  assert.equal(app.registered.get('sidebar.footer.action').meta.order, 440)
  assert.equal(app.registered.get('sidebar.footer.action').meta.id, 'dsh-docker.search-footer')
  assert.equal(app.registered.get('shell.overlay').meta.id, 'dsh-docker.search-panel')
  assert.equal(app.registered.get('plugins.item').meta.id, 'dsh-docker-web-search')
  const footer = app.registered.get('sidebar.footer.action').component
  const compact = footer({ wide: false })
  const wide = footer({ wide: true })
  assert.equal(compact.props['aria-label'], '网络搜索')
  assert.doesNotMatch(app.text(compact), /网络搜索/)
  assert.match(app.text(wide), /网络搜索/)
  assert.equal(compact.props.children[0].type.name, 'SearchIcon')
})

test('sidebar opens a spacious accessible overlay and both close controls work', () => {
  const app = harness()
  const footer = app.registered.get('sidebar.footer.action').component
  assert.equal(app.overlay(), null)
  footer({ wide: true }).props.onClick()
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
  footer({ wide: false }).props.onClick()
  panel = app.overlay()
  panel.props.onMouseDown({ target: panel, currentTarget: panel })
  assert.equal(app.overlay(), null)
})

test('opened settings reuse existing authenticated API and Brave controls', async () => {
  const app = harness()
  app.registered.get('sidebar.footer.action').component({ wide: true }).props.onClick()
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
  app.registered.get('sidebar.footer.action').component({ wide: true }).props.onClick()
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
  app.registered.get('sidebar.footer.action').component({ wide: true }).props.onClick()
  const panel = app.overlay()
  assert.equal(panel.props.className, 'dsh-search-overlay')
  let prevented = false
  app.keydown({ key: 'Escape', preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(app.overlay(), null)
})
