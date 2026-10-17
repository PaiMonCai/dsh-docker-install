'use strict'
// Run against an unpacked npm release, not a hand-written bundle fixture.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { transform } = require('../docker/patch-bili-client-ui.js')

test('published billion-context UI keeps every tab and external link on the DSH origin', async () => {
  const root = process.env.DSH_BILI_PACKAGE_ROOT
  assert.ok(root, 'set DSH_BILI_PACKAGE_ROOT to the unpacked billion-context package')
  const info = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(info.name, 'billion-context')
  const original = fs.readFileSync(path.join(root, 'dist/agent/dsh-native-client.js'), 'utf8')
  const patched = transform(original)
  assert.equal(patched.status, 'patched', 'the published bundle must be recognized')
  assert.equal(transform(patched.code).status, 'already-patched')

  const states = [], effects = [], entries = [], requests = [], opened = []
  let cursor = 0, exports
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = value }]
    },
    useEffect(effect) { effects.push(effect) },
  }
  const browser = {
    __BILI__: { origin: 'http://127.0.0.1:18787' },
    open: (...args) => opened.push(args),
    fetch: async url => {
      requests.push(url)
      return { ok: true, json: async () => ({ origin: 'http://127.0.0.1:18788' }) }
    },
    setTimeout: () => 1, clearTimeout() {},
    __ModuleLoader__: { load(module) {
      exports = module.factory(name => {
        assert.equal(name, 'react')
        return react
      })
    } },
  }
  browser.window = browser
  vm.runInNewContext(patched.code, browser, { timeout: 5000 })
  const dictionaries = {}
  exports.apply({
    effect: fn => fn(),
    locale: { register: (ns, dict) => { dictionaries[ns] = dict }, bind: ns => key => dictionaries[ns].zh[key] },
    slots: { inject: (_name, fn) => fn(), register: (meta, component) => entries.push({ meta, component }) },
  })
  const panel = entries.find(entry => entry.meta.name === 'settings.section').component
  const render = () => { cursor = 0; return panel() }
  function flatten(node) {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(flatten)
    return [node, ...node.children.flatMap(flatten)]
  }
  const remote = 'https://dsh.example.test'
  let nodes = flatten(render())
  // Mount effects once: origin discovery must retain its local Agent semantics.
  for (const effect of effects.splice(0)) effect()
  await new Promise(resolve => setImmediate(resolve))
  nodes = flatten(render())
  assert.ok(requests.includes('/bili/origin'))
  assert.equal(browser.__BILI__.origin, 'http://127.0.0.1:18787')
  for (const page of ['overview', 'sessions', 'config', 'logs']) {
    const frame = nodes.find(node => node.type === 'iframe')
    const url = new URL(frame.props.src, remote)
    assert.equal(url.origin, remote)
    assert.equal(url.pathname, '/__bili/')
    assert.equal(url.searchParams.get('embed'), '1')
    assert.equal(url.searchParams.get('lang'), 'zh')
    assert.equal(url.hash, '#/' + page)
    if (page !== 'logs') {
      const next = { overview: '会话', sessions: '配置', config: '日志' }[page]
      nodes.find(node => node.type === 'button' && node.children.includes(next)).props.onClick()
      nodes = flatten(render())
    }
  }
  nodes.find(node => node.type === 'button' && node.children.includes('打开 Web UI')).props.onClick()
  assert.equal(new URL(opened[0][0], remote).href, remote + '/__bili/')
  assert.equal(opened[0][2], 'noopener,noreferrer')
  assert.ok(requests.every(url => !/^https?:\/\/(?:127\.0\.0\.1|localhost)/.test(url)),
    'browser requests must never target the reader computer')
})
