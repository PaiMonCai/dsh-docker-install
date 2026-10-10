#!/usr/bin/env bash
# Use DSH Plugin Manager to keep the distribution's Web extension installed.
set -euo pipefail
export DSH_HOME="${DSH_HOME:-/root/.dsh}"
PACKAGE="dsh-docker-session-manager"
PACKAGE_DIR="/opt/dsh/plugins/dsh-session-manager-web"
MANIFEST="$DSH_HOME/profiles/web/package.json"
enabled() {
  local value="${DSH_SESSION_MANAGER_WEB:-true}"
  value="${value,,}"
  case "$value" in 0|false|no|off|disabled) return 1 ;; esac
  return 0
}
installed() {
  [[ -f "$MANIFEST" ]] || return 1
  node - "$MANIFEST" "$PACKAGE" <<'NODE'
const fs = require('fs')
const [file, name] = process.argv.slice(2)
try { process.exit(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')).dependencies || {}, name) ? 0 : 1) }
catch { process.exit(1) }
NODE
}
if enabled; then
  if ! installed; then dsh plugin --profile web add "link:$PACKAGE_DIR"; fi
elif installed; then
  dsh plugin --profile web remove "$PACKAGE"
fi
