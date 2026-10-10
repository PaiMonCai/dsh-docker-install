#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, lstatSync, chmodSync, symlinkSync, rmSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

const helper = join(__dirname, '../docker/dsh-web-token.js')
const patch = join(__dirname, '../docker/patch-web-launch-token.js')
const home = mkdtempSync(join(tmpdir(), 'dsh-web-token-'))
const env = { ...process.env, DSH_HOME: home }
const file = join(home, '.dshd-web-login-token.json')

function call(action, input = '') {
  return spawnSync(process.execPath, [helper, action], { input, encoding: 'utf8', env })
}

try {
  assert.equal(call('status').stdout.trim(), 'uninitialized')
  assert.equal(call('ensure').status, 0)
  const first = call('print')
  assert.equal(first.status, 0)
  assert.match(first.stdout, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(call('print').stdout, first.stdout)
  assert.equal(call('status').stdout.trim(), 'auto')
  assert.equal(lstatSync(file).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).mode, 'auto')

  const custom = 'My_Custom-PersistentLoginToken_1234567890XYZ'
  const changed = call('set', custom + '\n')
  assert.equal(changed.status, 0, changed.stderr)
  assert.doesNotMatch(changed.stdout + changed.stderr, /My_Custom-PersistentLoginToken/)
  assert.equal(call('status').stdout.trim(), 'custom')
  assert.equal(call('print').stdout, custom)
  assert.equal(call('print').stdout, custom)
  assert.equal(lstatSync(file).mode & 0o777, 0o600)

  for (const bad of ['short\n', 'a'.repeat(129), 'a'.repeat(20) + ' password!\n']) {
    const failure = call('set', bad)
    assert.notEqual(failure.status, 0)
    assert.equal(call('print').stdout, custom)
  }
  assert.notEqual(call('set').status, 0)
  assert.notEqual(spawnSync(process.execPath, [helper, 'set', custom],
    { encoding: 'utf8', env }).status, 0, 'never accept a secret in command arguments')

  const reset = call('reset')
  assert.equal(reset.status, 0, reset.stderr)
  const second = call('print').stdout
  assert.notEqual(second, first.stdout)
  assert.notEqual(second, custom)
  assert.equal(call('status').stdout.trim(), 'auto')
  assert.equal(lstatSync(file).mode & 0o777, 0o600)

  chmodSync(file, 0o644)
  assert.notEqual(call('print').status, 0, 'insecure permissions must fail closed')
  chmodSync(file, 0o600)
  unlinkSync(file)
  symlinkSync('/etc/passwd', file)
  assert.notEqual(call('print').status, 0, 'symlink attacks must be refused')
  unlinkSync(file)
  writeFileSync(file, 'broken json', { mode: 0o600 })
  assert.notEqual(call('print').status, 0, 'invalid persistent state must fail closed')
  unlinkSync(file)
  assert.equal(call('ensure').status, 0)
  assert.match(call('print').stdout, /^[A-Za-z0-9_-]{43}$/)

  execFileSync(process.execPath, [patch, '--self-test'], { stdio: 'pipe' })
  assert.match(readFileSync('Dockerfile', 'utf8'), /patch-web-launch-token\.js/)
  assert.match(readFileSync('docker/entrypoint.sh', 'utf8'), /DSH_WEB_LOGIN_TOKEN/)
  assert.match(readFileSync('dshd', 'utf8'), /dshd token status/)
  console.log('Persisted Web login token lifecycle and patch tests passed')
} finally {
  rmSync(home, { recursive: true, force: true })
}
