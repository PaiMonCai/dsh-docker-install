#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check docker/prepare-native-web-plugins.js
node --check docker/compose-native-web-patch.js
bash -n docker/entrypoint.sh
! grep -Eq 'ensure_(icon_dock|web_search|session_manager_web|reasoning_editor)' docker/entrypoint.sh
! grep -Eq 'dsh plugin --profile web add' docker/entrypoint.sh

for bundle in dsh-icon-dock dsh-session-manager-web dsh-web-search dsh-reasoning-editor; do
  grep -Eq '^[[:space:]]+name: \./index\.js$' "docker/plugins/$bundle/cordis.patch.yml"
done

# The DSH CLI only accepts a single --patch. Verify the startup composer
# keeps all enabled patch rows and uses absolute paths to built-in modules.
tmp_patch_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_patch_dir"' EXIT
export DSH_NATIVE_PLUGIN_ROOT="$PWD/docker/plugins"
export DSH_BIND_PATCH="$PWD/docker/dsh-bind.patch.yml"
export DSH_NATIVE_PATCH_OUTPUT="$tmp_patch_dir/native-web.patch.yml"
node docker/compose-native-web-patch.js >"$tmp_patch_dir/out"
[[ "$(cat "$tmp_patch_dir/out")" == "$DSH_NATIVE_PATCH_OUTPUT" ]]
grep -Fq -- "- id: webserver" "$DSH_NATIVE_PATCH_OUTPUT"
grep -Fq -- "name: $DSH_NATIVE_PLUGIN_ROOT/dsh-icon-dock/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
grep -Fq -- "name: $DSH_NATIVE_PLUGIN_ROOT/dsh-session-manager-web/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
grep -Fq -- "name: $DSH_NATIVE_PLUGIN_ROOT/dsh-reasoning-editor/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
! grep -Fq -- "dsh-web-search/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
DSH_SEARCH_ENABLED=true node docker/compose-native-web-patch.js >/dev/null
grep -Fq -- "name: $DSH_NATIVE_PLUGIN_ROOT/dsh-web-search/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
grep -Fq -- "searchProvider: dsh-docker-search" "$DSH_NATIVE_PATCH_OUTPUT"
DSH_ICON_DOCK_ENABLED=false node docker/compose-native-web-patch.js >/dev/null
! grep -Fq -- "dsh-icon-dock/index.js" "$DSH_NATIVE_PATCH_OUTPUT"
if DSH_SEARCH_ENABLED=garbled node docker/compose-native-web-patch.js >/dev/null 2>&1; then
  echo "expected invalid opt-in to fail" >&2
  exit 1
fi
grep -Fq 'args+=(--patch "$merged_patch")' docker/entrypoint.sh

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
