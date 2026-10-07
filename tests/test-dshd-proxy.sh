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
  [[ "$DSH_PROXY_NO_PROXY" == *",dsh,dsh-proxy" ]] || fail "default NO_PROXY should include container and sidecar"
  [[ "$DSH_PROXY_IMAGE" == "ghcr.io/sagernet/sing-box:v1.14.2" ]] || fail "unexpected proxy image: $DSH_PROXY_IMAGE"

  proxy_write_url_node corp-http 'http://alice:secret@proxy.example.com:8080'
  grep -Fq '"type":"http"' "$(proxy_node_file corp-http)" || fail "http node type missing"
  grep -Fq '"server":"proxy.example.com"' "$(proxy_node_file corp-http)" || fail "http node host missing"
  grep -Fq '"server_port":8080' "$(proxy_node_file corp-http)" || fail "http node port missing"
  grep -Fq '"username":"alice"' "$(proxy_node_file corp-http)" || fail "http node username missing"
  grep -Fq '"password":"secret"' "$(proxy_node_file corp-http)" || fail "http node password missing"

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

test_proxy_defaults_and_nodes
test_proxy_config_persists

printf '[✓] dshd proxy tests passed\n'
