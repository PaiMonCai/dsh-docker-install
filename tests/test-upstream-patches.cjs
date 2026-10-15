'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ci/upstream-patches.json'), 'utf8'));
test('patch inventory is complete and valid', () => {
  assert.equal(manifest.schemaVersion, 1);
  const actual = fs.readdirSync(path.join(root, 'docker')).filter(x => /^patch-.*\.js$/.test(x)).map(x => 'docker/' + x).sort();
  const tracked = manifest.patches.map(x => x.file).sort();
  assert.deepEqual(tracked, actual);
  assert.equal(new Set(manifest.patches.map(x => x.id)).size, tracked.length);
  for (const p of manifest.patches) {
    assert.ok(['low', 'medium', 'high'].includes(p.risk));
    for (const key of ['phase', 'dependency', 'strategy', 'validation', 'exitCriteria']) assert.ok(p[key], p.id + ': ' + key);
  }
});
