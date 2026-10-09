import assert from 'node:assert/strict'
import { compareVersions, detectUpdate } from '../ci/semver-max.mjs'

const older = (a, b) => assert.ok(compareVersions(a, b) < 0, a + ' must precede ' + b)
older('0.2.1-alpha', '0.2.1-alpha.1')
older('0.2.1-alpha.2', '0.2.1-alpha.10')
older('0.2.1-alpha.10', '0.2.1-beta')
older('0.2.1-rc.1', '0.2.1')
older('0.2.1', '0.2.2-alpha.1')
older('0.2.1-1', '0.2.1-alpha')
assert.equal(compareVersions('1.0.0+build.1', '1.0.0+build.2'), 0)
assert.equal(compareVersions('0.2.1-alpha.2', '0.2.1-alpha.2'), 0)
assert.deepEqual(detectUpdate({
  versions: { '0.2.1-alpha': {}, '0.2.1-alpha.1': {}, '0.2.1-alpha.2': {} },
  'dist-tags': { latest: '0.2.1-alpha', alpha: '0.2.1-alpha.2' },
}, '0.2.1-alpha.1'), {
  latest: '0.2.1-alpha.2', updated: true, channels: ['alpha'],
})
assert.equal(detectUpdate({
  versions: { '0.2.1-alpha.2': {}, '0.2.1-alpha.1': {} },
}, '0.2.1-alpha.2').updated, false)
assert.throws(() => detectUpdate({}, '0.2.1-alpha.1'), /versions/)
assert.throws(() => detectUpdate({ versions: {} }, '0.2.1-alpha.1'), /no valid/)
console.log('[✓] DSH npm SemVer update precedence tests passed')
