#!/usr/bin/env bash
# Reconcile only the image-bundled web-search plugin via official DSH Plugin Manager.
set -euo pipefail
export DSH_HOME="${DSH_HOME:-/root/.dsh}"
package="dsh-docker-web-search"
directory="/opt/dsh/plugins/dsh-web-search"
manifest="$DSH_HOME/profiles/web/package.json"
enabled="${DSH_SEARCH_ENABLED:-false}"

installed() {
  [[ -f "$manifest" ]] || return 1
  node - "$manifest" "$package" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  process.exit(Object.hasOwn(data.dependencies || {}, name) ? 0 : 1)
} catch { process.exit(1) }
NODE
}
case "${enabled,,}" in
  true|1|yes|on)
    [[ -f "$directory/package.json" ]] || { echo "search plugin package missing" >&2; exit 1; }
    if ! installed; then dsh plugin --profile web add "link:$directory"; fi
    ;;
  false|0|no|off)
    if installed; then dsh plugin --profile web remove "$package"; fi
    ;;
  *)
    echo "invalid DSH_SEARCH_ENABLED: $enabled" >&2
    exit 1
    ;;
esac
