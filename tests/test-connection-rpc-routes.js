#!/usr/bin/env node
'use strict'
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const patch = 'docker/patch-connection-rpc-routes.js'
execFileSync(process.execPath, ['--check', patch], { stdio: 'inherit' })
execFileSync(process.execPath, [patch, '--self-test'], { stdio: 'inherit' })
const root = mkdtempSync(join(tmpdir(), 'dsh-rpc-405-'))
try {
  const dir = join(root, '@deepseek-ai', 'dsh-client-connection', 'lib')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'rpc-host.js')
  const vulnerable = [
    'class HostConnectionService {',
    '  register(owner, route) {',
    '    return owner.effect(() => owner.webServer.register(route), "client-connection: /files rpc channel")',
    '  }',
    '}',
  ].join('\n')
  writeFileSync(file, vulnerable)
  execFileSync(process.execPath, [patch], { env: { ...process.env, DSH_PATCH_NPM_ROOT: root } })
  const first = readFileSync(file, 'utf8')
  assert.match(first, /this\.ctx\.get\('webServer'\)/)
  assert.match(first, /DSH Docker RPC channel route fix/)
  execFileSync(process.execPath, [patch], { env: { ...process.env, DSH_PATCH_NPM_ROOT: root } })
  assert.equal(readFileSync(file, 'utf8'), first, 'idempotency')
  assert.match(readFileSync('Dockerfile', 'utf8'), /patch-connection-rpc-routes\.js/)
  assert.match(readFileSync('.github/workflows/build.yml', 'utf8'), /test-connection-rpc-routes\.js/)
  // Unknown version fails instead of continuing to ship silent 405.
  writeFileSync(file, 'class HostConnectionService {}')
  const bad = spawnSync(process.execPath, [patch], { env: { ...process.env, DSH_PATCH_NPM_ROOT: root }, encoding: 'utf8' })
  assert.notEqual(bad.status, 0)
  assert.equal(readFileSync(file, 'utf8'), 'class HostConnectionService {}')
  console.log('DSH RPC 405 production patch regression checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
