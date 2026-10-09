'use strict'

const assert = require('node:assert/strict')
const { resolveBindHost, isWildcardHost } = require('../docker/resolve-bind-host.js')

const interfaces = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth1: [{ address: '172.20.0.4', family: 'IPv4', internal: false }],
  eth0: [{ address: '172.19.0.3', family: 'IPv4', internal: false }],
}
assert.equal(resolveBindHost('', interfaces), '172.19.0.3')
assert.equal(resolveBindHost('127.0.0.1', interfaces), '127.0.0.1')
assert.equal(resolveBindHost('::1', interfaces), '::1')
assert.equal(resolveBindHost('10.20.30.40', interfaces), '10.20.30.40')
assert.equal(resolveBindHost('', { enp0s3: interfaces.eth1 }), '172.20.0.4')
assert.equal(resolveBindHost('', { lo: interfaces.lo }), '127.0.0.1')
assert.equal(resolveBindHost('', { eth0: [{ address: '2001:db8::42', family: 'IPv6', internal: false }] }), '2001:db8::42')
assert.equal(resolveBindHost('', { eth0: [{ address: 'fe80::42', family: 'IPv6', internal: false }] }), '127.0.0.1')
for (const invalid of [
  '0.0.0.0', '::', '::0', '0:0:0:0:0:0:0:0',
  '::ffff:0:0', '::ffff:0.0.0.0', '0:0:0:0:0:ffff:0:0',
  'localhost', 'example.com',
]) {
  assert.throws(() => resolveBindHost(invalid, interfaces), /DSH_BIND_HOST/)
}
for (const valid of ['::1', '2001:db8::42', '::ffff:127.0.0.1']) {
  assert.equal(isWildcardHost(valid), false)
}
// Compose must forward its .env bind override into the container environment.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const compose = readFileSync(join(__dirname, '..', 'docker-compose.yml'), 'utf8')
assert.match(compose, /DSH_BIND_HOST:\s*"\$\{DSH_BIND_HOST:-\}"/)
console.log('[✓] Concrete DSH container bind-host tests passed')
