#!/usr/bin/env bash
# Install the independent icon dock before optional extensions register actions.
set -euo pipefail
export DSH_HOME="${DSH_HOME:-/root/.dsh}"
package="dsh-docker-icon-dock"
directory="/opt/dsh/plugins/dsh-icon-dock"
manifest="$DSH_HOME/profiles/web/package.json"
installed() {
  [[ -f "$manifest" ]] || return 1
  node - "$manifest" "$package" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
try { process.exit(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')).dependencies || {}, name) ? 0 : 1) }
catch { process.exit(1) }
NODE
}
if [[ "${DSH_ICON_DOCK_ENABLED:-true}" =~ ^([Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff])$ ]]; then
  if installed; then dsh plugin --profile web remove "$package"; fi
elif ! installed; then
  dsh plugin --profile web add "link:$directory"
fi
