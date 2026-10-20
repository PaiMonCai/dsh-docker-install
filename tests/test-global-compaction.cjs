'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')

test('compaction fallback explicitly enables all three native host plugins', () => {
  const patch = read('docker/plugins/dsh-global-compaction/cordis.patch.yml')
  for (const id of ['compaction-basic', 'command-compact', 'tool-result-pruner']) {
    assert.ok(patch.includes('- id: ' + id + '\n  disabled: false'), id)
  }
  for (const value of ['auto: true', 'thresholdRatio: 0.8', 'headroomTokens: 65536',
    'retainRatio: 0.16', 'thresholdChars: 8192', 'headChars: 4096', 'tailChars: 1024']) {
    assert.ok(patch.includes(value), value)
  }
  assert.doesNotMatch(patch, /- insert:|reverse-engineering|reverse-report-reader/)
})

test('global Web overlay follows Reverse preset patch and precedes Web flags', () => {
  const source = read('docker/entrypoint.sh')
  const web = source.slice(source.indexOf('run_web() {'))
  const reverse = web.indexOf('append_native_web_patch "${DSH_REVERSE_AGENT_PATCH}"')
  const global = web.indexOf('append_native_web_patch "/opt/dsh/plugins/dsh-global-compaction/cordis.patch.yml"')
  const migrate = web.indexOf('    prepare_native_web_plugins')
  const webFlags = web.indexOf('    args+=(--no-open)')
  assert.ok(reverse >= 0 && reverse < global && global < migrate && migrate < webFlags)
  assert.ok(web.includes('${DSH_GLOBAL_COMPACTION:-true}'))
  assert.ok(read('Dockerfile').includes('COPY docker/plugins/dsh-global-compaction/'))
  assert.ok(read('Dockerfile').includes('--dump-config > /tmp/dsh-global-compaction-config.yml'))
})

test('both image compose variants expose opt-out without rewriting user profiles', () => {
  for (const name of ['docker-compose.yml', 'docker-compose.reverse.yml']) {
    assert.ok(read(name).includes('DSH_GLOBAL_COMPACTION: "${DSH_GLOBAL_COMPACTION:-true}"'), name)
  }
  assert.match(read('docs/deployment.md'), /allowDshCompaction/)
  assert.match(read('docs/deployment.md'), /dsh_compaction_refused/)
})
