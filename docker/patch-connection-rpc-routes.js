#!/usr/bin/env node
'use strict'

// DSH generic Connection RPC registrations access owner.webServer in a fiber
// that did not inject webServer. Their routes never mount: POST -> SPA 405.
// Use the same optional service lookup as HostConnectionService.admit().
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const MARKER = 'DSH Docker RPC channel route fix'
const suffix = path.join('@deepseek-ai', 'dsh-client-connection', 'lib', 'index.js')
const BUG = /owner\.effect\(\s*\(\)\s*=>\s*owner\.webServer\.register\(route\)/g

// Keep the existing owner.effect lifetime and authentication route handler.
const FIX = [
  'owner.effect(() => {',
  '      /* ' + MARKER + ' */',
  "      const webServer = this.ctx.get('webServer')",
  "      if (webServer === undefined) throw new Error('client-connection: RPC channel webServer unavailable')",
  '      return webServer.register(route)',
  '    }',
].join('\n')

function transform(source) {
  if (source.includes(MARKER)) return { content: source, status: 'already-patched' }
  if (!source.includes('HostConnectionService') || !source.includes('rpc channel')) {
    throw new Error('not a recognized HostConnectionService implementation')
  }
  let count = 0
  const content = source.replace(BUG, () => {
    count += 1
    return FIX
  })
  if (count !== 1) throw new Error('expected one vulnerable RPC channel registration; found ' + count)
  return { content, status: 'patched' }
}

function walk(dir, results) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, results)
    else if (entry.isFile() && full.endsWith(suffix)) results.push(full)
  }
}

function writeAtomically(file, value) {
  const info = fs.statSync(file)
  const temp = path.join(path.dirname(file), '.' + path.basename(file) + '.dsh-rpc-' + process.pid)
  try {
    fs.writeFileSync(temp, value, { mode: info.mode })
    fs.renameSync(temp, file)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}

function selfTest() {
  const vulnerable = [
    'class HostConnectionService {',
    '  register(owner, route) {',
    '    return owner.effect(',
    '      () => owner.webServer.register(route),',
    '      "client-connection: /files rpc channel"',
    '    )',
    '  }',
    '}',
  ].join('\n')
  const fixed = transform(vulnerable)
  if (fixed.status !== 'patched' || transform(fixed.content).content !== fixed.content) {
    throw new Error('patch must apply once and be idempotent')
  }
  const vm = require('node:vm')
  const route = { kind: 'prefix', path: '/files' }
  let mounts = 0, unmounts = 0
  const webServer = { register(given) {
    if (given !== route) throw new Error('wrong route')
    mounts++
    return () => { unmounts++ }
  } }
  // Guarded provider cannot read owner.webServer, but its .get() is valid.
  const provider = { get(name) { if (name !== 'webServer') throw new Error(name); return webServer } }
  const owner = { effect(callback) { return callback() } }
  const Sample = vm.runInNewContext(fixed.content + '\nHostConnectionService')
  const instance = new Sample()
  instance.ctx = provider
  const dispose = instance.register(owner, route)
  if (mounts !== 1 || typeof dispose !== 'function') throw new Error('route not mounted')
  dispose()
  if (unmounts !== 1) throw new Error('disposal not retained')
  let failed = false
  try { transform('class HostConnectionService { rpc channel }') } catch { failed = true }
  if (!failed) throw new Error('unknown upstream layout must fail closed')
  process.stdout.write('DSH RPC 405 route patch self-test passed\n')
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest()
  const root = process.env.DSH_PATCH_NPM_ROOT || execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  const results = []
  walk(root, results)
  if (results.length === 0) {
    throw new Error('DSH client-connection built rpc-host.js not found under ' + root)
  }
  for (const file of results) {
    const before = fs.readFileSync(file, 'utf8')
    const after = transform(before)
    if (after.status === 'patched') writeAtomically(file, after.content)
    process.stdout.write('DSH RPC 405 route ' + after.status + ': ' + file + '\n')
  }
}

try { main() } catch (error) {
  process.stderr.write('DSH RPC 405 route patch FAILED: ' + String(error) + '\n')
  process.exitCode = 1
}
