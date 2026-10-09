'use strict'

const assert = require('node:assert/strict')
const { resolveBindHost } = require('../docker/resolve-bind-host.js')

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
assert.throws(() => resolveBindHost('', { lo: interfaces.lo }), /non-loopback/)
for (const invalid of ['0.0.0.0', '::', '::ffff:0.0.0.0', 'localhost', 'example.com']) {
  assert.throws(() => resolveBindHost(invalid, interfaces), /DSH_BIND_HOST/)
}
console.log('[✓] Concrete DSH container bind-host tests passed')
