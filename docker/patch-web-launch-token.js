#!/usr/bin/env node
'use strict'

// Patch only the per-process launch-token source. Browser cookie signing,
// Host/Origin trust and the cookie verification path remain untouched.
// Unknown upstream versions fail the IMAGE BUILD, not production authentication.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const MARKER = 'DSH Docker persistent Web login token'
const suffix = path.join('@deepseek-ai', 'dsh-client-connection', 'lib', 'index.js')
const pattern = /(\b(?:const|let|var)\s+created\s*=\s*)(encodeBase64Url\(\s*randomBytes\(\s*(?:SECRET_BYTES|32)\s*\)\s*\))/g

function transform(source) {
  if (source.includes(MARKER)) return { content: source, status: 'already-patched' }
  if (!source.includes('processLaunchToken') || !source.includes('PROCESS_LAUNCH_TOKENS')
    || !source.includes('BrowserAuth')) {
    throw new Error('unrecognized DSH browser launch-token implementation')
  }
  let matches = 0
  const content = source.replace(pattern, (whole, prefix, fallback) => {
    matches++
    return prefix + '(/* ' + MARKER + ' */ process.env.DSH_WEB_LOGIN_TOKEN || ' + fallback + ')'
  })
  if (matches !== 1) throw new Error('expected one upstream launch-token generator, found ' + matches)
  return { content, status: 'patched' }
}

function walk(dir, results) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return }
  for (const item of entries) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) walk(full, results)
    else if (item.isFile() && full.endsWith(suffix)) results.push(full)
  }
}

function patchFile(file) {
  const original = fs.readFileSync(file, 'utf8')
  const result = transform(original)
  if (result.status === 'already-patched') return result.status
  const mode = fs.statSync(file).mode
  const tmp = file + '.dsh-token-' + process.pid
  try {
    fs.writeFileSync(tmp, result.content, { mode })
    fs.renameSync(tmp, file)
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
  return result.status
}

function selfTest() {
  const sample = [
    'const PROCESS_LAUNCH_TOKENS = new WeakMap()',
    'function processLaunchToken(owner) {',
    '  const existing = PROCESS_LAUNCH_TOKENS.get(owner)',
    '  if (existing !== undefined) return existing',
    '  const created = encodeBase64Url(randomBytes(SECRET_BYTES))',
    '  PROCESS_LAUNCH_TOKENS.set(owner, created)',
    '  return created',
    '}',
    'class BrowserAuth {}',
  ].join('\n')
  const first = transform(sample)
  if (first.status !== 'patched' || transform(first.content).content !== first.content
    || !first.content.includes('process.env.DSH_WEB_LOGIN_TOKEN ||')) {
    throw new Error('launch-token patch is not idempotent')
  }
  // Simulate this generator exactly without modifying cookie signing.
  const vm = require('node:vm')
  const adapted = first.content.replace('class BrowserAuth {}', '')
  const context = { WeakMap, randomBytes: require('node:crypto').randomBytes,
    encodeBase64Url: buf => buf.toString('base64url'), SECRET_BYTES: 32,
    process: { env: { DSH_WEB_LOGIN_TOKEN: 'CustomFixedToken1234567890_ABC_defghij' } } }
  const generator = vm.runInNewContext(adapted + '\nprocessLaunchToken', context)
  const owner = {}
  if (generator(owner) !== context.process.env.DSH_WEB_LOGIN_TOKEN || generator(owner) !== generator(owner)) {
    throw new Error('persistent token was not used')
  }
  const fallback = { ...context, process: { env: {} } }
  if (!/^[A-Za-z0-9_-]{43}$/.test(vm.runInNewContext(adapted + '\nprocessLaunchToken', fallback)({}))) {
    throw new Error('upstream random fallback changed')
  }
  let refused = false
  try { transform('function processLaunchToken() {} class BrowserAuth {}') }
  catch { refused = true }
  if (!refused) throw new Error('unrecognized version must fail closed')
  process.stdout.write('Persistent Web login token patch self-test passed\n')
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest()
  const root = process.env.DSH_PATCH_NPM_ROOT || execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  const files = []
  walk(root, files)
  if (files.length !== 1) throw new Error('expected one DSH Connection bundle, found ' + files.length)
  process.stdout.write('DSH Web token patch ' + patchFile(files[0]) + '\n')
}

try { main() }
catch (error) {
  process.stderr.write('DSH Web token patch FAILED: ' + error.message + '\n')
  process.exitCode = 1
}
