#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

test_proxy_defaults_and_nodes() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_PROXY_ENABLED DSH_PROXY_NODE DSH_PROXY_IMAGE DSH_PROXY_PORT DSH_PROXY_NO_PROXY || true
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config

  [[ "$DSH_PROXY_ENABLED" == "false" ]] || fail "proxy should default to disabled"
  [[ "$DSH_PROXY_PORT" == "7890" ]] || fail "unexpected proxy port: $DSH_PROXY_PORT"
  [[ "$DSH_PROXY_NO_PROXY" == *"host.docker.internal,dsh,dsh-proxy" ]] || fail "default NO_PROXY should include host gateway, container and sidecar"
  [[ "$DSH_PROXY_IMAGE" == "ghcr.io/sagernet/sing-box:v1.14.2" ]] || fail "unexpected proxy image: $DSH_PROXY_IMAGE"

  proxy_write_url_node corp-http 'http://alice:secret@proxy.example.com:8080'
  grep -Fq '"type":"http"' "$(proxy_node_file corp-http)" || fail "http node type missing"
  grep -Fq '"server":"proxy.example.com"' "$(proxy_node_file corp-http)" || fail "http node host missing"
  grep -Fq '"server_port":8080' "$(proxy_node_file corp-http)" || fail "http node port missing"
  grep -Fq '"username":"alice"' "$(proxy_node_file corp-http)" || fail "http node username missing"
  grep -Fq '"password":"secret"' "$(proxy_node_file corp-http)" || fail "http node password missing"
  [[ "$(proxy_node_description corp-http)" == "http://proxy.example.com:8080" ]] || fail "node description should omit credentials"


  proxy_write_url_node socks 'socks5h://127.0.0.1:1080'
  grep -Fq '"type":"socks"' "$(proxy_node_file socks)" || fail "socks node type missing"

  proxy_write_json_node hy2 '{"type":"hysteria2","tag":"proxy","server":"example.com","server_port":443,"password":"test","tls":{"enabled":true}}'
  grep -Fq '"type":"hysteria2"' "$(proxy_node_file hy2)" || fail "json node not stored"

  DSH_PROXY_NODE=corp-http
  proxy_generate_config
  grep -Fq '"type":"mixed"' "$PROXY_CONFIG_FILE" || fail "mixed inbound missing"
  grep -Fq '"listen_port":7890' "$PROXY_CONFIG_FILE" || fail "mixed port missing"
  grep -Fq '"final":"proxy"' "$PROXY_CONFIG_FILE" || fail "route final missing"
)

test_proxy_config_persists() (
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
  DSH_PROXY_ENABLED=true
  DSH_PROXY_NODE=jp01
  DSH_PROXY_PORT=17890
  DSH_PROXY_IMAGE=example.invalid/sing-box:test
  save_config

  grep -q '^DSH_PROXY_ENABLED=true$' "$CONFIG_FILE" || fail "proxy enabled flag not persisted"
  grep -q '^DSH_PROXY_NODE=jp01$' "$CONFIG_FILE" || fail "proxy node not persisted"
  grep -q '^DSH_PROXY_PORT=17890$' "$CONFIG_FILE" || fail "proxy port not persisted"
  grep -q '^DSH_PROXY_IMAGE=example.invalid/sing-box:test$' "$CONFIG_FILE" || fail "proxy image not persisted"
)

test_active_node_switch_does_not_recreate_dsh() (
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
  proxy_write_url_node a 'http://a.example.com:8080'
  proxy_write_url_node b 'http://b.example.com:8081'
  DSH_PROXY_ENABLED=true
  DSH_PROXY_NODE=a
  save_config

  ensure_docker() { :; }
  proxy_start_sidecar() { printf '%s\n' "$DSH_PROXY_NODE" >"$tmp/reloaded-node"; }
  create_container() { fail "switching an active proxy node must not recreate DSH"; }

  cmd_proxy use b
  [[ "$(cat "$tmp/reloaded-node")" == "b" ]] || fail "active node switch did not reload sidecar"
  grep -q '^DSH_PROXY_NODE=b$' "$CONFIG_FILE" || fail "active node switch not persisted"
)

test_first_run_wizard_defaults_to_url_node() (
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
  proxy_apply_change() { save_config; }
  container_running() { return 1; }

  printf '\n\nhttp://proxy.example.com:8080\n' | proxy_setup_wizard >/dev/null
  proxy_node_exists node1 || fail "first-run wizard should create default node1"
  grep -q '^DSH_PROXY_ENABLED=true$' "$CONFIG_FILE" || fail "first-run wizard should enable proxy by default"
  grep -q '^DSH_PROXY_NODE=node1$' "$CONFIG_FILE" || fail "first-run wizard should select node1"
)

test_nested_node_description_uses_top_level_type() (
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
  proxy_write_json_node vless '{"type":"vless","tag":"proxy","server":"edge.example.com","server_port":443,"uuid":"x","transport":{"type":"ws","path":"/ws"},"tls":{"enabled":true}}'
  [[ "$(proxy_node_description vless)" == "vless://edge.example.com:443" ]] || fail "nested type should not override outbound type"
)

test_proxy_defaults_and_nodes
test_proxy_config_persists
test_active_node_switch_does_not_recreate_dsh
test_first_run_wizard_defaults_to_url_node
test_nested_node_description_uses_top_level_type

printf '[✓] dshd proxy tests passed\n'
