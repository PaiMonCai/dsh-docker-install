'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../docker/plugins/dsh-instance-manager/client.js'), 'utf8')
const digest = letter => 'sha256:' + letter.repeat(64)
const initial = () => ({
  configured: true, online: true, jobs: [],
  status: {
    instance: { id: 'default', name: 'dsh-test', image: 'example/dsh:reverse', edition: 'reverse' },
    container: { state: 'running', version: '0.2.1-alpha.4', imageId: digest('a'), health: 'healthy' },
    release: { current: digest('a'), latest: digest('b'), available: true, checkedAt: new Date().toISOString() },
    settings: { checkInterval: 21600 }, proxy: { nodes: [], running: false },
  },
})
function harness() {
  let definition, current, cursor
  const stores = new Map(), entries = new Map(), timers = new Map(), storage = new Map()
  let nextTimer = 0
  const f = { data: initial(), calls: 0, fail: false }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++, store = current
      if (!(index in store.values)) store.values[index] = typeof initial === 'function' ? initial() : initial
      return [store.values[index], value => {
        store.values[index] = typeof value === 'function' ? value(store.values[index]) : value
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in current.values)) current.values[index] = { current: initial }
      return current.values[index]
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = current.deps[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        current.deps[index] = [...deps]
        current.effects.push(effect)
      }
    },
    useSyncExternalStore: (_subscribe, read) => read(),
  }
  const memory = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  const window = { __ModuleLoader__: { load: value => { definition = value } } }
  vm.runInNewContext(source, {
    window, console, localStorage: memory, sessionStorage: memory,
    AbortController, AbortSignal,
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id },
    clearTimeout: id => timers.delete(id),
    fetch: async () => {
      f.calls++
      if (f.fail) throw Error('disconnected')
      return { ok: true, json: async () => structuredClone(f.data) }
    },
  })
  definition.factory(name => { assert.equal(name, 'react'); return React }).apply({
    slots: { inject: (_name, fn) => fn(), register: (meta, component) => entries.set(meta.id, component) },
  })
  function render(component, props = {}) {
    if (!stores.has(component)) stores.set(component, { values: [], deps: [], effects: [] })
    current = stores.get(component); cursor = 0
    const tree = component(props)
    for (const effect of current.effects.splice(0)) effect()
    return expand(tree)
  }
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand)
    if (!tree || typeof tree !== 'object') return tree
    if (typeof tree.type === 'function') return render(tree.type, tree.props)
    return { ...tree, props: { ...tree.props, children: expand(tree.props.children) } }
  }
  f.shortcuts = window.__dshDockerIconDockPendingV1 || []
  f.entry = props => render(entries.get('dsh-docker-instance-manager'), props)
  f.notice = () => render(entries.get('dsh-docker.instance-manager-update-notice'))
  f.poll = async delay => {
    const pending = [...timers].filter(([, timer]) => timer.delay === delay)
    assert.ok(pending.length, 'missing poll timer ' + delay)
    for (const [id, timer] of pending) { timers.delete(id); await timer.fn() }
    await new Promise(resolve => setImmediate(resolve))
  }
  f.settle = () => new Promise(resolve => setImmediate(resolve))
  return f
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree == null || tree === false) return ''
  return typeof tree === 'object' ? text(tree.props.children) : String(tree)
}

test('plugin summary is a compact description without controls or polling; detail opens the manager', async () => {
  const f = harness()
  assert.equal(f.entry({ view: 'summary' }), '管理 DSH 更新、运行状态与网络出口')
  await f.settle()
  assert.equal(f.calls, 0)
  f.entry({ view: 'detail' })
  await f.settle()
  const detail = f.entry({ view: 'detail' })
  assert.match(text(detail), /当前 DSH 版本/)
  assert.equal(nodes(detail, node => node.props.role === 'tab').length, 4)
  assert.equal(f.calls, 1)
})

test('notice accepts a real image update even when DSH version is unchanged', async () => {
  const f = harness()
  f.notice(); await f.settle()
  assert.match(text(f.notice()), /DSH 有可用镜像更新/)
})

test('external upgrade clears stale detail and notice immediately through panel polling', async () => {
  const f = harness()
  f.notice(); f.entry({ view: 'detail' }); await f.settle()
  assert.match(text(f.notice()), /DSH 有可用镜像更新/)
  f.data.status.container.imageId = digest('b')
  await f.poll(3000)
  assert.equal(f.notice(), null)
  const detail = f.entry({ view: 'detail' })
  assert.doesNotMatch(text(detail), /检测到可用更新/)
  assert.match(text(detail), /运行镜像或更新源已变化/)
})

test('notice rejects results for a different image source and hides while replacing or disconnected', async () => {
  for (const change of [
    f => { f.data.status.release.target = 'example/dsh:latest' },
    f => { f.data.jobs = [{ action: 'update', state: 'running' }] },
    f => { f.data.online = false },
    f => { f.fail = true },
  ]) {
    const f = harness()
    f.notice(); await f.settle()
    assert.ok(f.notice())
    change(f)
    await f.poll(60000)
    assert.equal(f.notice(), null)
  }
})

test('panel connection loss also clears the notice before the background notice poll', async () => {
  const f = harness()
  f.notice(); f.entry({ view: 'detail' }); await f.settle()
  assert.ok(f.notice())
  f.fail = true
  await f.poll(3000)
  assert.equal(f.notice(), null)
  assert.match(text(f.entry({ view: 'detail' })), /连接暂时断开/)
})

test('dismissal lasts for the same target but a newer image can notify again', async () => {
  const f = harness()
  f.notice(); await f.settle()
  nodes(f.notice(), node => node.props['aria-label'] === '稍后提醒')[0].props.onClick()
  await f.poll(60000)
  assert.equal(f.notice(), null)
  f.data.status.release.latest = digest('c')
  await f.poll(60000)
  assert.ok(f.notice())
})

test('failed registry checks remain visible in details and never create update notices', async () => {
  const f = harness()
  f.data.status.release = { available: null, error: 'registry unavailable' }
  f.notice(); f.entry({ view: 'detail' }); await f.settle()
  assert.equal(f.notice(), null)
  assert.match(text(f.entry({ view: 'detail' })), /更新检查失败：registry unavailable/)
})

test('live runtime logs are reachable from manager and the dedicated shortcut is registered', async () => {
  const f = harness()
  assert.ok(f.shortcuts.some(entry => entry.id === 'dsh-docker.runtime-logs'
    && entry.label === '运行日志' && entry.icon === 'terminal'))
  f.data.status.logs = '[INFO] DSH booted\\n[WARN] retry network\\n[ERROR] failed request'
  f.data.status.logsUpdatedAt = new Date().toISOString()
  f.entry({ view: 'detail' })
  await f.settle()
  let tree = f.entry({ view: 'detail' })
  const tab = nodes(tree, node => node.props.role === 'tab' && text(node) === '运行日志')[0]
  assert.ok(tab)
  tab.props.onClick()
  tree = f.entry({ view: 'detail' })
  assert.match(text(tree), /自动刷新/)
  assert.match(text(tree), /DSH booted/)
  const level = nodes(tree, node => node.props['aria-label'] === '日志级别')[0]
  level.props.onChange({ target: { value: 'error' } })
  tree = f.entry({ view: 'detail' })
  const output = nodes(tree, node => node.props['aria-label'] === 'DSH 运行日志')[0]
  assert.match(text(output), /ERROR/)
  assert.doesNotMatch(text(output), /WARN|INFO/)
  // The panel poll period shortens only while the log tab is selected.
  await f.poll(3000)
  await f.poll(2000)
})

test('log search and pause freeze the display while status continues to refresh', async () => {
  const f = harness()
  f.data.status.logs = 'startup completed\\nERROR first failure'
  f.entry({ view: 'detail' })
  await f.settle()
  let tree = f.entry({ view: 'detail' })
  nodes(tree, n => n.props.role === 'tab' && text(n) === '运行日志')[0].props.onClick()
  tree = f.entry({ view: 'detail' })
  const search = nodes(tree, n => n.props['aria-label'] === '搜索运行日志')[0]
  search.props.onChange({ target: { value: 'failure' } })
  tree = f.entry({ view: 'detail' })
  assert.doesNotMatch(text(nodes(tree, n => n.props.role === 'log')[0]), /startup/)
  nodes(tree, n => n.type === 'button' && text(n) === '暂停显示')[0].props.onClick()
  f.data.status.logs = 'ERROR new failure\\nINFO restarted'
  await f.poll(3000)
  tree = f.entry({ view: 'detail' })
  assert.match(text(nodes(tree, n => n.props.role === 'log')[0]), /first failure/)
  assert.doesNotMatch(text(nodes(tree, n => n.props.role === 'log')[0]), /new failure/)
  nodes(tree, n => n.type === 'button' && text(n) === '继续显示')[0].props.onClick()
  tree = f.entry({ view: 'detail' })
  assert.match(text(nodes(tree, n => n.props.role === 'log')[0]), /new failure/)
})
