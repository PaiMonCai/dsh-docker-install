#!/usr/bin/env node
'use strict'

// Read-only diagnostics for image-bundled DSH Web plugins. This is deliberately
// separate from the installer/launcher: a failed doctor must never repair or
// rewrite the user's persistent Web Profile, third-party plugins or lockfile.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')

const PLUGINS = [
  { dir: 'dsh-icon-dock', id: 'dsh-docker-icon-dock', label: 'Icon Dock', required: true },
  { dir: 'dsh-session-manager-web', id: 'dsh-docker-session-manager',
    label: 'Session Manager', required: true, api: '/api/dsh-docker-session-manager' },
  { dir: 'dsh-reasoning-editor', id: 'dsh-docker-reasoning-editor',
    label: 'Reasoning Editor', required: true },
  { dir: 'dsh-web-search', id: 'dsh-docker-web-search', label: 'Web Search', required: false },
]

function row(code, state, detail) { return { code, state, detail } }

function inspectStatic(options = {}) {
  const source = options.fs || fs
  const home = options.home || process.env.DSH_HOME || '/root/.dsh'
  const root = options.root || '/opt/dsh/plugins'
  const processArgs = options.processArgs || []
  const records = []
  let selected = []
  const profilePath = path.join(home, 'profiles/web/package.json')
  if (source.existsSync(profilePath)) {
    try {
      const profile = JSON.parse(source.readFileSync(profilePath, 'utf8'))
      selected = profile.dsh?.profile?.bundles ?? []
      if (!Array.isArray(selected)) throw Error('bundles must be an array')
      records.push(row('profile', 'ok', 'Web Profile readable; third-party entries preserved'))
    } catch {
      records.push(row('profile', 'error', 'Web Profile manifest malformed'))
    }
  } else records.push(row('profile', 'ok', 'no persisted Web Profile yet'))

  const argv = processArgs.find(args => Array.isArray(args) && args.includes('web')
    && args.includes('--patch'))
  let patch = ''
  if (!argv) {
    records.push(row('launcher', 'error', 'DSH Web process and native launcher patches not found'))
  } else {
    const patches = []
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--patch') patches.push(argv[++i])
    }
    const webArgIndex = argv.indexOf('--no-open')
    const invalidOrder = webArgIndex >= 0 && argv.slice(webArgIndex).includes('--patch')
    if (patches.length < 1 || invalidOrder || new Set(patches).size !== patches.length) {
      records.push(row('launcher', 'error',
        'native --patch arguments must be unique and precede Web application flags'))
    } else {
      try {
        patch = patches.map(file => source.readFileSync(file, 'utf8')).join('\n')
        if (!patch.includes('- id: webserver')) throw Error('webserver overlay missing')
        records.push(row('launcher', 'ok',
          patches.length + ' official native patch layers loaded'))
      } catch {
        records.push(row('launcher', 'error', 'native patch file missing or invalid'))
      }
    }
  }
  const enabled = []
  for (const plugin of PLUGINS) {
    const base = path.join(root, plugin.dir)
    const sourcePath = path.join(base, 'index.js')
    const registered = patch.includes('name: ' + sourcePath)
    const files = ['index.js', 'client.js', 'package.json', 'cordis.patch.yml']
    const present = files.every(f => source.existsSync(path.join(base, f)))
    let correctManifest = false
    if (present) {
      try { correctManifest = JSON.parse(source.readFileSync(path.join(base, 'package.json'), 'utf8')).name === plugin.id }
      catch { /* corrupted plugin manifest */ }
    }
    if (!present || !correctManifest) {
      records.push(row(plugin.id, 'error', 'bundled client/server files missing or invalid'))
    } else if (!registered) {
      records.push(row(plugin.id, plugin.required ? 'error' : 'disabled',
        plugin.required ? 'missing from native launcher' : 'not enabled in native launcher'))
    } else {
      enabled.push(plugin)
      records.push(row(plugin.id, 'ok', 'bundled and mounted by native loader'))
    }
    if (selected.includes(plugin.id)) {
      records.push(row('legacy:' + plugin.id, 'error',
        'legacy Profile bundle remains selected: duplicate loading risk'))
    }
  }
  return { records, enabled }
}

function processCommandLines(source = fs, procDir = '/proc') {
  let pids
  try { pids = source.readdirSync(procDir).filter(n => /^[0-9]+$/.test(n)) }
  catch { return [] }
  return pids.map(pid => {
    try { return source.readFileSync(path.join(procDir, pid, 'cmdline'), 'utf8').split('\0') }
    catch { return [] }
  })
}

function localRequest({ hostname, port, resource, cookie, timeoutMs = 5000 }) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname, port, path: resource,
      headers: {
        Host: '127.0.0.1:' + port,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      agent: false, timeout: timeoutMs,
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 2_000_000) request.destroy(Error('response size exceeded'))
      })
      response.on('end', () => resolve({ status: response.statusCode, body,
        cookies: response.headers['set-cookie'] || [] }))
    })
    request.on('timeout', () => request.destroy(Error('request timed out')))
    request.on('error', reject)
  })
}

async function inspectWeb({ enabled, request, getToken }) {
  const records = []
  let cookie
  try {
    // Authentication is local-only. The login token never appears in output
    // or process arguments, and the diagnostic only issues GET requests.
    const token = getToken()
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw Error('invalid token')
    const login = await request('/?token=' + encodeURIComponent(token))
    if (![200, 302, 303].includes(login.status)) throw Error('login response unexpected')
    cookie = login.cookies.map(c => c.split(';')[0]).join('; ')
    if (!cookie) throw Error('login cookie missing')
    const page = await request('/', cookie)
    if (page.status !== 200 || !page.body.includes('__DSH_BOOT__')) {
      throw Error('Web HTML does not provide client boot graph')
    }
    const missing = enabled.filter(p => !page.body.includes(p.id))
    if (missing.length) {
      records.push(row('client-graph', 'error',
        'browser boot graph missing: ' + missing.map(p => p.id).join(', ')))
    } else records.push(row('client-graph', 'ok', 'all enabled client modules in browser boot graph'))
  } catch {
    records.push(row('client-graph', 'error',
      'cannot authenticate and verify browser boot graph (check Web process and logs)'))
    return records
  }
  for (const plugin of enabled.filter(p => p.api)) {
    try {
      const response = await request(plugin.api, cookie)
      if (response.status !== 200) throw Error('unexpected response')
      const parsed = JSON.parse(response.body)
      if (!Array.isArray(parsed.items)) throw Error('invalid response')
      records.push(row('api:' + plugin.id, 'ok', 'authenticated plugin API reachable'))
    } catch {
      records.push(row('api:' + plugin.id, 'error', 'authenticated plugin API unavailable'))
    }
  }
  return records
}

function formatReport(records, json = false) {
  const healthy = !records.some(item => item.state === 'error')
  if (json) return JSON.stringify({ healthy, checks: records }, null, 2) + '\n'
  const lines = ['DSH Built-in Web Plugins', '']
  for (const item of records) {
    const symbol = item.state === 'error' ? 'FAIL' : item.state === 'disabled' ? 'OFF ' : ' OK '
    lines.push('[' + symbol + '] ' + item.code + ' — ' + item.detail)
  }
  lines.push('', 'Overall: ' + (healthy ? 'healthy' : 'degraded'))
  return lines.join('\n') + '\n'
}

async function main() {
  const flags = new Set(process.argv.slice(2))
  if ([...flags].some(flag => !['--json', '--static-only'].includes(flag))) {
    throw Error('usage: dsh-plugin-doctor.js [--json] [--static-only]')
  }
  const scan = inspectStatic({ processArgs: processCommandLines() })
  const records = [...scan.records]
  if (!flags.has('--static-only')) {
    const { resolveBindHost } = require('./resolve-bind-host.js')
    const hostname = resolveBindHost(process.env.DSH_BIND_HOST || '')
    const port = Number(process.env.DSH_PORT || '3080')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('invalid DSH_PORT')
    const request = (resource, cookie) => localRequest({ hostname, port, resource, cookie })
    const getToken = () => {
      const tokenFile = path.join(process.env.DSH_HOME || '/root/.dsh',
        '.dshd-web-login-token.json')
      return JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token
    }
    records.push(...await inspectWeb({ enabled: scan.enabled, request, getToken }))
  }
  process.stdout.write(formatReport(records, flags.has('--json')))
  if (records.some(item => item.state === 'error')) process.exitCode = 1
}

if (require.main === module) {
  main().catch(error => {
    // Never print secrets or authenticated URLs in diagnostics.
    process.stderr.write('dsh-plugin-doctor: ' + (error.code || error.message || 'check failed') + '\n')
    process.exitCode = 1
  })
}

module.exports = { PLUGINS, inspectStatic, inspectWeb, formatReport, processCommandLines }
