#!/usr/bin/env bash
set -euo pipefail
bash -n docker/ensure-web-search.sh
node --check docker/plugins/dsh-web-search/index.js
node --test tests/test-web-search.mjs
