#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check docker/prepare-native-web-plugins.js
bash -n docker/entrypoint.sh
! grep -Eq 'ensure_(icon_dock|web_search|session_manager_web|reasoning_editor)' docker/entrypoint.sh
! grep -Eq 'dsh plugin --profile web add' docker/entrypoint.sh

for bundle in dsh-icon-dock dsh-session-manager-web dsh-web-search dsh-reasoning-editor; do
  grep -Eq '^[[:space:]]+name: \./index\.js$' "docker/plugins/$bundle/cordis.patch.yml"
done

# The official DSH launcher supports repeatable --patch options, but its
# options MUST appear before the app's --no-open/--port options.
node - <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const source = fs.readFileSync('docker/entrypoint.sh', 'utf8')
assert.match(source, /local args=\(web --patch "\$BIND_PATCH"\)/)
for (const name of ['dsh-reasoning-editor', 'dsh-icon-dock',
  'dsh-session-manager-web', 'dsh-web-search']) {
  assert.ok(source.includes('append_native_web_patch "/opt/dsh/plugins/' +
    name + '/cordis.patch.yml"'), name)
}
const startup = source.slice(source.indexOf('run_web() {'))
const firstPatch = startup.indexOf('append_native_web_patch')
const migration = startup.indexOf('    prepare_native_web_plugins')
const webFlags = startup.indexOf('    args+=(--no-open)')
assert.ok(firstPatch >= 0 && firstPatch < migration && migration < webFlags,
  'preflight patches before persistent migration; app flags last')
assert.match(source, /args\+=\(--patch "\$file"\)/)
assert.doesNotMatch(source, /dsh plugin --profile web add/)
console.log('DSH launcher flag ordering checks passed')
NODE

node - <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { migrate } = require('./docker/prepare-native-web-plugins.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-native-'))
try {
  assert.deepEqual(migrate(root), [])
  const dir = path.join(root, 'profiles', 'web')
  fs.mkdirSync(dir, { recursive: true })
  const manifest = path.join(dir, 'package.json')
  const lock = path.join(dir, 'pnpm-lock.yaml')
  const original = {
    name: 'profile',
    dependencies: {
      dshmarket: '1.66.18',
      'dsh-docker-icon-dock': 'link:/opt/dsh/plugins/dsh-icon-dock',
      'dsh-docker-session-manager': 'link:/opt/dsh/plugins/dsh-session-manager-web',
      'dsh-docker-web-search': 'link:/opt/dsh/plugins/dsh-web-search',
      'dsh-docker-reasoning-editor': 'link:/opt/dsh/plugins/dsh-reasoning-editor',
    },
    dsh: { profile: { bundles: [
      '@deepseek-ai/dsh-base', 'dsh-docker-icon-dock',
      'dshmarket', 'dsh-docker-session-manager',
      'dsh-docker-reasoning-editor', 'dsh-docker-web-search',
    ] } },
    other: { keep: 123 },
  }
  const json = JSON.stringify(original, null, 2) + '\n'
  fs.writeFileSync(manifest, json)
  fs.writeFileSync(lock, 'LOCKFILE IS OPAQUE; DO NOT CHANGE\n')
  const removed = migrate(root)
  assert.equal(removed.length, 4)
  const after = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  assert.deepEqual(after.dsh.profile.bundles,
    ['@deepseek-ai/dsh-base', 'dshmarket'])
  assert.deepEqual(after.dependencies, original.dependencies)
  assert.deepEqual(after.other, original.other)
  assert.equal(fs.readFileSync(lock, 'utf8'), 'LOCKFILE IS OPAQUE; DO NOT CHANGE\n')
  assert.equal(fs.readFileSync(path.join(dir,
    'package.json.before-native-web-plugins'), 'utf8'), json)
  assert.deepEqual(migrate(root), [])
  assert.equal(fs.readFileSync(lock, 'utf8'), 'LOCKFILE IS OPAQUE; DO NOT CHANGE\n')

  fs.writeFileSync(manifest, JSON.stringify({
    dependencies: original.dependencies,
    dsh: { profile: { bundles: 'bad' } },
  }))
  assert.throws(() => migrate(root), /malformed/)
  // No automatic mutation on malformed/unexpected profile shape.
  assert.equal(JSON.parse(fs.readFileSync(manifest,'utf8')).dsh.profile.bundles, 'bad')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
console.log('Native Web migration checks passed')
NODE
