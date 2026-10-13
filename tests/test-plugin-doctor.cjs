#!/usr/bin/env node
'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PLUGINS, inspectStatic, inspectWeb, formatReport } =
  require('../docker/dsh-plugin-doctor.js')

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-doctor-'))
  const plugins = path.join(root, 'plugins')
  const home = path.join(root, 'home')
  const patchPath = path.join(root, 'native-web.patch.yml')
  const profile = path.join(home, 'profiles/web/package.json')
  fs.mkdirSync(path.dirname(profile), { recursive: true })
  fs.mkdirSync(plugins)
  let patch = '- id: webserver\n  config: {}\n'
  for (const entry of PLUGINS) {
    const dir = path.join(plugins, entry.dir)
    fs.mkdirSync(dir)
    for (const file of ['index.js', 'client.js', 'cordis.patch.yml'])
      fs.writeFileSync(path.join(dir, file), '// test\n')
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: entry.id }))
    if (entry.required) patch += '- insert:\n    - id: ' + entry.id +
      '\n      name: ' + path.join(dir, 'index.js') + '\n'
  }
  fs.writeFileSync(patchPath, patch)
  fs.writeFileSync(profile, JSON.stringify({
    dependencies: { dshmarket: '1.66.18' },
    dsh: { profile: { bundles: ['dshmarket'] } },
  }))
  const args = [['node', 'dsh', 'web', '--patch', patchPath, '--no-open']]
  const inspect = () => inspectStatic({ home, root: plugins, processArgs: args })
  return { root, home, plugins, patchPath, profile, args, inspect,
    cleanup() { fs.rmSync(root, { force: true, recursive: true }) } }
}

test('healthy native launcher is distinct from unrelated pnpm-managed plugins', () => {
  const t = setup()
  try {
    const result = t.inspect()
    assert.equal(result.records.filter(r => r.state === 'error').length, 0)
    assert.equal(result.enabled.length, 3)
    const search = result.records.find(r => r.code === 'dsh-docker-web-search')
    assert.equal(search.state, 'disabled')
    assert.ok(formatReport(result.records).includes('Overall: healthy'))
    assert.equal(JSON.parse(formatReport(result.records, true)).healthy, true)
  } finally { t.cleanup() }
})

test('missing native extension or out-of-order/duplicate --patch produces actionable errors', () => {
  const t = setup()
  try {
    t.args[0].push('--patch', t.patchPath)
    assert.match(t.inspect().records.find(r => r.code === 'launcher').detail, /precede/)
    t.args[0].splice(-2)
    fs.rmSync(path.join(t.plugins, 'dsh-icon-dock/client.js'))
    assert.equal(t.inspect().records.find(r => r.code === 'dsh-docker-icon-dock').state, 'error')
  } finally { t.cleanup() }
})

test('legacy selection conflicts are reported without editing user configuration', () => {
  const t = setup()
  try {
    const data = JSON.parse(fs.readFileSync(t.profile, 'utf8'))
    data.dsh.profile.bundles.push('dsh-docker-icon-dock')
    const original = JSON.stringify(data)
    fs.writeFileSync(t.profile, original)
    assert.ok(t.inspect().records.some(r =>
      r.code === 'legacy:dsh-docker-icon-dock' && r.state === 'error'))
    assert.equal(fs.readFileSync(t.profile, 'utf8'), original)
  } finally { t.cleanup() }
})

test('browser graph and plugin API must respond to authenticated GET checks', async () => {
  const events = []
  const token = 'a'.repeat(40)
  const enabled = PLUGINS.filter(p => p.required)
  const request = async (resource, cookie) => {
    events.push({ resource, cookie })
    if (resource.startsWith('/?token=')) return {
      status: 200, body: '', cookies: ['dsh-session=abc123; HttpOnly; SameSite=Lax'],
    }
    if (resource === '/') return {
      status: 200, body: '__DSH_BOOT__ ' + enabled.map(p => p.id).join(' '), cookies: [],
    }
    return { status: 200, body: '{"items":[]}', cookies: [] }
  }
  const checks = await inspectWeb({ enabled, request, getToken: () => token })
  assert.deepEqual(checks.map(r => r.state), ['ok', 'ok'])
  assert.equal(events[0].cookie, undefined)
  assert.equal(events[1].cookie, 'dsh-session=abc123')
  assert.ok(!formatReport(checks).includes(token), 'login token must never be reported')
})

test('missing browser registration fails even when native host package exists', async () => {
  const enabled = PLUGINS.filter(p => p.required)
  const request = async (resource) => resource.startsWith('/?token=') ?
    { status: 200, body: '', cookies: ['session=a; HttpOnly'] } :
    { status: 200, body: '__DSH_BOOT__ dsh-docker-icon-dock', cookies: [] }
  const records = await inspectWeb({ enabled, request, getToken: () => 'X'.repeat(40) })
  assert.equal(records[0].state, 'error')
  assert.match(records[0].detail, /session-manager/)
})

test('invalid login token fails closed without leaking its value', async () => {
  const secret = 'VERY_PRIVATE_BAD_TOKEN'
  const records = await inspectWeb({
    enabled: PLUGINS,
    request: () => { throw Error('should not send invalid token') },
    getToken: () => secret,
  })
  assert.equal(records[0].state, 'error')
  assert.ok(!formatReport(records).includes(secret))
})
