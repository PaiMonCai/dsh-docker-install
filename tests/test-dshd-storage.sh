#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

test_new_install_defaults_to_bind() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"
  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  [[ "$DSH_STORAGE_MODE" == "bind" ]] || fail "new install should default to bind"
  [[ "$DSH_DATA_DIR" == "$HOME/dsh/data" ]] || fail "unexpected default data dir: $DSH_DATA_DIR"
  [[ "$(storage_source)" == "$HOME/dsh/data" ]] || fail "storage_source should use bind path"
)

test_legacy_config_stays_volume() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME" "$DSHD_STATE_DIR"
  cat >"$DSHD_STATE_DIR/config.env" <<'EOF'
DSH_VOLUME=legacy-home
DSH_WORKSPACE=/srv/legacy-workspace
EOF
  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  [[ "$DSH_STORAGE_MODE" == "volume" ]] || fail "legacy config should stay volume"
  [[ "$DSH_VOLUME" == "legacy-home" ]] || fail "legacy volume name changed"
  [[ "$(storage_source)" == "legacy-home" ]] || fail "storage_source should use legacy volume"
)

test_bind_config_roundtrip() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"
  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  DSH_STORAGE_MODE=bind
  DSH_DATA_DIR=/opt/dsh/data
  DSH_WORKSPACE=/opt/dsh/workspace
  save_config
  grep -q '^DSH_STORAGE_MODE=bind$' "$CONFIG_FILE" || fail "storage mode not persisted"
  grep -q '^DSH_DATA_DIR=/opt/dsh/data$' "$CONFIG_FILE" || fail "data dir not persisted"
  grep -q '^DSH_WORKSPACE=/opt/dsh/workspace$' "$CONFIG_FILE" || fail "workspace not persisted"
)

test_new_install_defaults_to_bind
test_legacy_config_stays_volume
test_bind_config_roundtrip

printf '[✓] dshd storage tests passed\n'
