#!/usr/bin/env node
'use strict'
// Compares ALL image-owned Standard plugin bundles with Reverse. No static
// plugin-name allowlist: discovery uses the installed Web client manifests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')

const PLUGIN_ROOT = '/opt/dsh/plugins'
const ENTRYPOINT = '/usr/local/bin/dsh-entrypoint'

function listFiles(dir, relative = '') {
  const files = []
  for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw Error('symlink in bundled plugin: ' + name)
    if (entry.isDirectory()) files.push(...listFiles(dir, name))
    else if (entry.isFile()) {
      const data = fs.readFileSync(path.join(dir, name))
      files.push({ path: name, sha256: crypto.createHash('sha256').update(data).digest('hex') })
    } else throw Error('unsupported bundled plugin entry: ' + name)
  }
  return files
}

function declaredPatches(entrypointText) {
  // Read the exact same native overlay declarations the Standard Web launcher
  // uses. This also discovers future plugins and their on/off env switches.
  const patches = []
  const pattern = /append_native_web_patch\s+"(\/opt\/dsh\/plugins\/[^"]+\/cordis\.patch\.yml)"\s+"([^"]+)"/g
  for (const match of entrypointText.matchAll(pattern)) {
    const expression = match[2]
    const setting = /^\x24\x7b([A-Z][A-Z0-9_]*):-(true|false)\}$/.exec(expression)
    if (!setting && expression !== 'true') {
      throw Error('unsupported native plugin toggle: ' + match[1])
    }
    patches.push({ path: match[1], setting: setting ? setting[1] : null, defaultEnabled: setting ? setting[2] === 'true' : true })
  }
  if (!patches.length) throw Error('Standard entrypoint declares no native Web plugins')
  if (new Set(patches.map(p => p.path)).size !== patches.length) throw Error('duplicate native Web patch declaration')
  return patches.sort((a, b) => a.path.localeCompare(b.path))
}

function snapshot(pluginRoot = PLUGIN_ROOT, entrypointPath = ENTRYPOINT) {
  const overlays = declaredPatches(fs.readFileSync(entrypointPath, 'utf8'))
  const plugins = []
  for (const entry of fs.readdirSync(pluginRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('invalid plugin directory: ' + entry.name)
    const dir = path.join(pluginRoot, entry.name)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name) throw Error('invalid plugin package name: ' + entry.name)
    const web = manifest.dsh?.client?.platform === 'web'
    // A strictly explicit image-owned marker distinguishes headless server
    // routes from browser modules. Do not require fake client.js scripts.
    const serverOnly = manifest.dshDockerServerOnly === true
    if (web && serverOnly) throw Error('conflicting plugin capabilities: ' + entry.name)
    const files = listFiles(dir)
    if (web) {
      for (const name of ['package.json', 'client.js', 'index.js', 'cordis.patch.yml']) {
        if (!files.some(f => f.path === name)) throw Error('incomplete Web plugin: ' + entry.name + '/' + name)
      }
      const overlay = path.posix.join('/opt/dsh/plugins', entry.name, 'cordis.patch.yml')
      if (!overlays.some(o => o.path === overlay)) throw Error('Web plugin not registered in Standard launcher: ' + manifest.name)
    }
    if (serverOnly) {
      for (const name of ['package.json', 'index.js', 'cordis.patch.yml']) {
        if (!files.some(f => f.path === name)) throw Error('incomplete server-only plugin: ' + entry.name + '/' + name)
      }
    }
    plugins.push({ directory: entry.name, id: manifest.name, web, serverOnly, files })
  }
  if (!plugins.some(p => p.web)) throw Error('no Web client plugins discovered')
  for (const overlay of overlays) {
    const dir = overlay.path.slice('/opt/dsh/plugins/'.length).split('/')[0]
    if (!plugins.some(p => p.directory === dir && (p.web || p.serverOnly))) {
      throw Error('launcher references missing Web or server-only plugin: ' + overlay.path)
    }
  }
  if (new Set(plugins.map(p => p.id)).size !== plugins.length) throw Error('duplicate plugin package IDs')
  return { schema: 1, plugins, overlays }
}

function compare(expected, actual) {
  assert.equal(expected.schema, 1)
  assert.equal(actual.schema, 1)
  const byDirectory = new Map(actual.plugins.map(p => [p.directory, p]))
  for (const plugin of expected.plugins) {
    const found = byDirectory.get(plugin.directory)
    assert.ok(found, 'Reverse omitted Standard plugin: ' + plugin.id)
    assert.equal(found.id, plugin.id, 'plugin identity changed: ' + plugin.directory)
    assert.equal(found.web, plugin.web, 'plugin Web capability changed: ' + plugin.id)
    assert.equal(found.serverOnly, plugin.serverOnly, 'plugin server capability changed: ' + plugin.id)
    assert.deepEqual(found.files, plugin.files, 'Reverse changed inherited Standard plugin files: ' + plugin.id)
  }
  assert.deepEqual(actual.plugins.map(p => p.directory), expected.plugins.map(p => p.directory),
    'Reverse plugin directory inventory differs from Standard')
  assert.deepEqual(actual.overlays, expected.overlays, 'Reverse changed Standard Web launcher overlays')
}

function parseLauncherPatches() {
  for (const pid of fs.readdirSync('/proc').filter(x => /^[0-9]+$/.test(x))) {
    let args
    try { args = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\0') } catch { continue }
    if (!args.includes('web') || !args.includes('--patch')) continue
    const appStart = args.indexOf('--no-open')
    if (appStart < 0) continue
    const overlays = []
    for (let i = args.indexOf('web') + 1; i < appStart; i++) {
      if (args[i] === '--patch') overlays.push(args[++i])
    }
    if (args.slice(appStart).includes('--patch')) throw Error('Web launcher patch after app flags')
    return overlays
  }
  throw Error('cannot find running DSH Web launcher')
}

function request(host, port, resource, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: host, port, path: resource, agent: false, timeout: 10000,
      headers: { Host: '127.0.0.1:' + port, ...(cookie ? { Cookie: cookie } : {}) },
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', part => {
        body += part
        if (body.length > 2_000_000) req.destroy(Error('Web response too large'))
      })
      response.on('end', () => resolve({ status: response.statusCode, body, cookies: response.headers['set-cookie'] || [] }))
    })
    req.on('timeout', () => req.destroy(Error('Web request timed out')))
    req.on('error', reject)
  })
}

async function verifyRuntime(expected) {
  const actual = snapshot()
  compare(expected, actual)
  const mounted = parseLauncherPatches()
  for (const patch of expected.overlays) {
    assert.ok(mounted.includes(patch.path), 'Standard Web overlay not mounted by Reverse: ' + patch.path)
  }
  const { resolveBindHost } = require('/usr/local/bin/resolve-bind-host.js')
  const host = resolveBindHost(process.env.DSH_BIND_HOST || '')
  const port = Number(process.env.DSH_PORT || '3080')
  const home = process.env.DSH_HOME || '/root/.dsh'
  const token = JSON.parse(fs.readFileSync(path.join(home, '.dshd-web-login-token.json'), 'utf8')).token
  assert.match(token, /^[A-Za-z0-9_-]{32,128}$/, 'invalid Web login token')
  const login = await request(host, port, '/?token=' + encodeURIComponent(token))
  assert.ok([200, 302, 303].includes(login.status), 'Web login failed')
  const cookie = login.cookies.map(c => c.split(';')[0]).join('; ')
  assert.ok(cookie, 'Web login cookie missing')
  const page = await request(host, port, '/', cookie)
  assert.equal(page.status, 200, 'authenticated Web page did not load')
  assert.ok(page.body.includes('__DSH_BOOT__'), 'DSH browser boot graph missing')
  for (const plugin of expected.plugins.filter(p => p.web)) {
    assert.ok(page.body.includes(plugin.id), 'Reverse browser boot graph missing Standard plugin: ' + plugin.id)
  }
  process.stdout.write('Verified ' + expected.plugins.length + ' inherited plugin bundles, ' +
    expected.plugins.filter(p => p.web).length + ' active Web client modules and ' +
    expected.overlays.length + ' runtime overlays\n')
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'snapshot') {
    if (args.length) throw Error('snapshot accepts no arguments')
    process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n')
  } else if (mode === 'compare') {
    if (args.length !== 2) throw Error('compare expects Standard and Reverse JSON files')
    compare(JSON.parse(fs.readFileSync(args[0], 'utf8')), JSON.parse(fs.readFileSync(args[1], 'utf8')))
    process.stdout.write('Reverse plugin inventory exactly matches Standard\n')
  } else if (mode === 'env') {
    if (args.length !== 1) throw Error('env expects Standard snapshot file')
    const s = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    for (const overlay of s.overlays) if (overlay.setting) process.stdout.write(overlay.setting + '=true\n')
  } else if (mode === 'verify-runtime') {
    if (args.length !== 1) throw Error('verify-runtime expects Standard snapshot file')
    await verifyRuntime(JSON.parse(fs.readFileSync(args[0], 'utf8')))
  } else throw Error('usage: reverse-web-parity.cjs snapshot | compare STANDARD REVERSE | env STANDARD | verify-runtime STANDARD')
}

if (require.main === module || process.argv[1] === '-') main().catch(error => {
  // Never print cookies or the login token.
  process.stderr.write('reverse-web-parity: ' + error.message + '\n')
  process.exitCode = 1
})
module.exports = { listFiles, declaredPatches, snapshot, compare }
