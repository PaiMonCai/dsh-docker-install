#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

test_dashboard_defaults_and_paths() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_RESEARCH_DASHBOARD_PORT DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config

  [[ "$DSH_RESEARCH_DASHBOARD_PORT" == "8765" ]]     || fail "unexpected dashboard port: $DSH_RESEARCH_DASHBOARD_PORT"
  [[ "$(dashboard_container_name)" == "dsh-dashboard" ]]     || fail "unexpected dashboard container name"
  [[ "$(dashboard_project_path .)" == "/workspace" ]]     || fail "dot project should map to /workspace"
  [[ "$(dashboard_project_path my-study)" == "/workspace/my-study" ]]     || fail "relative project mapping failed"
  [[ "$(dashboard_project_path /workspace/my-study)" == "/workspace/my-study" ]]     || fail "absolute /workspace project mapping failed"

  if dashboard_project_path ../escape >/dev/null 2>&1; then
    fail "parent traversal must be rejected"
  fi
  if dashboard_project_path /etc >/dev/null 2>&1; then
    fail "absolute path outside /workspace must be rejected"
  fi
)

test_dashboard_port_persists() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_RESEARCH_DASHBOARD_PORT DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  DSH_RESEARCH_DASHBOARD_PORT=9876
  save_config
  grep -q '^DSH_RESEARCH_DASHBOARD_PORT=9876$' "$CONFIG_FILE"     || fail "dashboard port not persisted"
)

test_dashboard_defaults_and_paths
test_dashboard_port_persists

printf '[✓] dshd dashboard tests passed\n'
