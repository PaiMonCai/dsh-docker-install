#!/usr/bin/env bash
# Reconcile the standalone Web icon dock via DSH Plugin Manager only.
# Never edit a profile manifest, pnpm lockfile, or security policy here.
set -euo pipefail
export DSH_HOME="${DSH_HOME:-/root/.dsh}"
package="dsh-docker-icon-dock"
directory="${DSH_ICON_DOCK_PACKAGE_DIR:-/opt/dsh/plugins/dsh-icon-dock}"
manifest="$DSH_HOME/profiles/web/package.json"

log() { printf 'dsh-icon-dock: %s\n' "$*" >&2; }

installed() {
  [[ -f "$manifest" ]] || return 1
  node - "$manifest" "$package" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
try {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'))
  process.exit(Object.hasOwn(p.dependencies || {}, name) ? 0 : 1)
} catch { process.exit(1) }
NODE
}

selected() {
  [[ -f "$manifest" ]] || return 1
  node - "$manifest" "$package" <<'NODE'
const fs = require('node:fs')
const [file, name] = process.argv.slice(2)
try {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'))
  process.exit(p.dsh?.profile?.bundles?.includes(name) ? 0 : 1)
} catch { process.exit(1) }
NODE
}

case "${DSH_ICON_DOCK_ENABLED:-true}" in
  [Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]|[Oo][Ff][Ff])
    if installed; then
      log "disabled by DSH_ICON_DOCK_ENABLED; removing this plugin through DSH Plugin Manager"
      dsh plugin --profile web remove "$package"
    fi
    exit 0
    ;;
esac

if [[ ! -f "$directory/package.json" ]]; then
  log "bundled package missing: $directory/package.json"
  exit 1
fi

if ! installed; then
  log "installing bundled icon dock into persistent Web Profile"
  output="$(mktemp)"
  trap 'rm -f "$output"' EXIT
  if ! dsh plugin --profile web add "link:$directory" >"$output" 2>&1; then
    cat "$output" >&2
    if grep -Eq 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|Lockfile failed supply-chain policy check' "$output"; then
      log "installation blocked by the existing Web Profile lockfile's pnpm minimumReleaseAge policy."
      log "This is NOT an icon dock JavaScript error. A recent third-party dependency is too new."
      log "Keep pnpm-lock.yaml and profile data intact; do not disable global supply-chain checks."
      log "When the named dependency passes its release-age window, retry:"
      log "  bash /usr/local/bin/ensure-dsh-icon-dock && restart the DSH container"
    else
      log "installation failed; inspect the pnpm diagnostics above and Web Profile logs."
    fi
    exit 1
  fi
  cat "$output"
  rm -f "$output"
  trap - EXIT
fi

if ! installed; then
  log "the plugin command returned successfully but the Web Profile still lacks $package"
  exit 1
fi
if ! selected; then
  log "package installed but not enabled in dsh.profile.bundles; check the Plugins page for disabled/error state."
  exit 1
fi
log "installed and selected in Web Profile"
