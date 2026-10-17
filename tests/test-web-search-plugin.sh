#!/usr/bin/env bash
set -euo pipefail
bash tests/test-native-web-plugins.sh
node --check docker/plugins/dsh-web-search/index.js
node --check docker/plugins/dsh-web-search/client.js
node --test tests/test-web-search-sidebar.cjs
node --check docker/plugins/dsh-web-search/embedded.js
node --check docker/plugins/dsh-web-search/settings.js
node --test tests/test-web-search.mjs tests/test-embedded-web-search.mjs

# DSH patch grammar: only "insert" may be a patch directive; updates
# must be top-level rows with an id. This regression previously passed
# source tests but failed at "dsh --profile web --dump-config".
node --input-type=module - <<'NODE'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const patch = readFileSync('docker/plugins/dsh-web-search/cordis.patch.yml', 'utf8')
assert.doesNotMatch(patch, /^- patch:/m, 'DSH does not support nested - patch: directives')
assert.match(patch, /^- insert:\s*\n\s+- id: dsh-docker-web-search\n\s+name: \.\/index\.js/m)
assert.match(patch, /^- id: web\n  config:\n    searchProvider: deepseek-official\n    fetchProvider: http/m)
const custom = readFileSync('docker/plugins/dsh-web-search/cordis.searxng.patch.yml', 'utf8')
assert.match(custom, /^- id: web\n  config:\n    searchProvider: dsh-docker-search\n    fetchProvider: http/m)
assert.match(patch, /^- id: tool-web\n  config:\n    fetch: true\n    search: true\n    searchTimeoutMs: 12000/m)
NODE
