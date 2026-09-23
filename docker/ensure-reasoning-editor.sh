#!/usr/bin/env bash
# Reconcile the image-bundled reasoning editor through DSH's own Plugin Manager.
#
# This script never edits profile manifests directly. The profile package and
# dsh.profile.bundles remain owned by `dsh plugin`.
set -euo pipefail

export DSH_HOME="${DSH_HOME:-/root/.dsh}"

PACKAGE="dsh-docker-reasoning-editor"
PACKAGE_DIR="${DSH_REASONING_EDITOR_PACKAGE_DIR:-/opt/dsh/plugins/dsh-reasoning-editor}"
PROFILE="web"
MANIFEST="$DSH_HOME/profiles/$PROFILE/package.json"

log() { printf 'dsh-reasoning-editor: %s\n' "$*" >&2; }

enabled() {
  local value="${DSH_REASONING_EDITOR:-true}"
  value="${value,,}"
  case "$value" in
    0|false|no|off|disabled) return 1 ;;
    *) return 0 ;;
  esac
}

installed() {
  [[ -f "$MANIFEST" ]] || return 1
  node - "$MANIFEST" "$PACKAGE" <<'NODE'
const fs = require('fs')
const [manifestPath, packageName] = process.argv.slice(2)
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  process.exit(Object.prototype.hasOwnProperty.call(manifest.dependencies || {}, packageName) ? 0 : 1)
} catch {
  process.exit(1)
}
NODE
}

if [[ ! -f "$PACKAGE_DIR/package.json" ]]; then
  log "bundled package missing: $PACKAGE_DIR"
  exit 1
fi

if enabled; then
  if installed; then
    exit 0
  fi
  log "enabling bundled custom-model reasoning editor in profile '$PROFILE'"
  exec dsh plugin --profile "$PROFILE" add "link:$PACKAGE_DIR"
fi

# Explicit opt-out should survive restarts. Remove only our own package and let
# Plugin Manager reconcile its bundle row; unrelated profile state is untouched.
if installed; then
  log "DSH_REASONING_EDITOR is disabled; removing bundled editor from profile '$PROFILE'"
  exec dsh plugin --profile "$PROFILE" remove "$PACKAGE"
fi
