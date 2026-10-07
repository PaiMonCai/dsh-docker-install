#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

assert_json_file() {
  local file="$1"
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$file" \
    || fail "invalid JSON: $file"
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
  grep -Fq '"type":"local","tag":"local"' "$PROXY_CONFIG_FILE" || fail "local DNS resolver missing"
  grep -Fq '"default_domain_resolver":"local"' "$PROXY_CONFIG_FILE" || fail "default domain resolver missing"
  assert_json_file "$PROXY_CONFIG_FILE"
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

  printf '\nhttp://proxy.example.com:8080#node1\n\n' | proxy_setup_wizard >/dev/null
  proxy_node_exists node1 || fail "first-run wizard should create default node1"
  grep -q '^DSH_PROXY_ENABLED=true$' "$CONFIG_FILE" || fail "first-run wizard should enable proxy by default"
  grep -q '^DSH_PROXY_NODE=node1$' "$CONFIG_FILE" || fail "first-run wizard should select node1"
)

test_share_link_imports() (
  local tmp ss_user
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

  proxy_write_node_input vless-ws 'vless://11111111-1111-1111-1111-111111111111@edge.example.com:443?security=tls&sni=cdn.example.com&type=ws&host=cdn.example.com&path=%2Fws%3Fed%3D2048&fp=chrome#test'
  grep -Fq '"type":"vless"' "$(proxy_node_file vless-ws)" || fail "vless type missing"
  grep -Fq '"uuid":"11111111-1111-1111-1111-111111111111"' "$(proxy_node_file vless-ws)" || fail "vless uuid missing"
  grep -Fq '"server_name":"cdn.example.com"' "$(proxy_node_file vless-ws)" || fail "vless sni missing"
  grep -Fq '"fingerprint":"chrome"' "$(proxy_node_file vless-ws)" || fail "vless utls fingerprint missing"
  grep -Fq '"type":"ws"' "$(proxy_node_file vless-ws)" || fail "vless ws transport missing"
  grep -Fq '"path":"/ws?ed=2048"' "$(proxy_node_file vless-ws)" || fail "vless ws path decode failed"
  grep -Fq '"Host":"cdn.example.com"' "$(proxy_node_file vless-ws)" || fail "vless ws host missing"

  proxy_write_node_input reality 'vless://22222222-2222-2222-2222-222222222222@1.2.3.4:443?security=reality&sni=www.example.com&pbk=public-key&sid=0123abcd&type=tcp&flow=xtls-rprx-vision'
  grep -Fq '"flow":"xtls-rprx-vision"' "$(proxy_node_file reality)" || fail "vless flow missing"
  grep -Fq '"reality":{"enabled":true,"public_key":"public-key","short_id":"0123abcd"}' "$(proxy_node_file reality)" || fail "reality fields missing"

  proxy_write_node_input trojan 'trojan://p%40ss@example.net:443?security=tls&sni=example.net&type=grpc&serviceName=TunService'
  grep -Fq '"password":"p@ss"' "$(proxy_node_file trojan)" || fail "trojan password decode failed"
  grep -Fq '"type":"grpc","service_name":"TunService"' "$(proxy_node_file trojan)" || fail "trojan grpc transport missing"

  proxy_write_node_input hy2 'hysteria2://secret@hy.example.com:8443?sni=hy.example.com&insecure=1&obfs=salamander&obfs-password=obfs%20secret'
  grep -Fq '"type":"hysteria2"' "$(proxy_node_file hy2)" || fail "hysteria2 type missing"
  grep -Fq '"insecure":true' "$(proxy_node_file hy2)" || fail "hysteria2 insecure missing"
  grep -Fq '"obfs":{"type":"salamander","password":"obfs secret"}' "$(proxy_node_file hy2)" || fail "hysteria2 obfs missing"

  ss_user="$(printf '%s' 'aes-256-gcm:ss-secret' | base64 | tr -d '\n=' | tr '+/' '-_')"
  proxy_write_node_input ss "ss://${ss_user}@ss.example.com:8388#test"
  grep -Fq '"type":"shadowsocks"' "$(proxy_node_file ss)" || fail "shadowsocks type missing"
  grep -Fq '"method":"aes-256-gcm"' "$(proxy_node_file ss)" || fail "shadowsocks method missing"
  grep -Fq '"password":"ss-secret"' "$(proxy_node_file ss)" || fail "shadowsocks password missing"

  assert_json_file "$(proxy_node_file vless-ws)"
  assert_json_file "$(proxy_node_file reality)"
  assert_json_file "$(proxy_node_file trojan)"
  assert_json_file "$(proxy_node_file hy2)"
  assert_json_file "$(proxy_node_file ss)"
)

test_auto_node_names() (
  local tmp name1 name2
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

  name1="$(proxy_auto_node_name 'vless://id@example.com:443#Tokyo%20Edge')"
  [[ "$name1" == "Tokyo-Edge" ]] || fail "fragment auto name failed: $name1"
  proxy_write_node_input "$name1" 'vless://11111111-1111-1111-1111-111111111111@example.com:443#Tokyo%20Edge'

  name2="$(proxy_auto_node_name 'vless://id@example.com:443#Tokyo%20Edge')"
  [[ "$name2" == "Tokyo-Edge-2" ]] || fail "duplicate auto name should get suffix: $name2"

  [[ "$(proxy_auto_node_name 'http://proxy.example.com:8080')" == "node1" ]] || fail "URL without fragment should fall back to nodeN"
)

test_subscription_imports() (
  local tmp raw_file base64_file encoded
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

  raw_file="$tmp/raw-sub.txt"
  cat >"$raw_file" <<'EOF'
vless://11111111-1111-1111-1111-111111111111@a.example.com:443?security=tls#A
vmess://unsupported
trojan://secret@b.example.com:443?security=tls#B
EOF
  proxy_import_subscription "$raw_file" >/dev/null
  proxy_node_exists A || fail "raw subscription should import VLESS"
  proxy_node_exists B || fail "raw subscription should import Trojan"
  [[ "$DSH_PROXY_NODE" == "A" ]] || fail "first imported node should become current when none exists"
  [[ "$PROXY_IMPORT_FIRST_NAME" == "A" ]] || fail "first imported node should be exposed to wizard"

  base64_file="$tmp/base64-sub.txt"
  encoded="$(printf '%s\n%s\n'     'hysteria2://secret@hy.example.com:443?sni=hy.example.com#HY'     'ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#SS'     | base64 | tr -d '\n')"
  printf '%s' "$encoded" >"$base64_file"
  proxy_import_subscription "$base64_file" >/dev/null
  proxy_node_exists HY || fail "base64 subscription should import Hysteria2"
  proxy_node_exists SS || fail "base64 subscription should import Shadowsocks"
  [[ "$DSH_PROXY_NODE" == "A" ]] || fail "subscription import must not silently switch an existing current node"
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
test_share_link_imports
test_auto_node_names
test_subscription_imports
test_nested_node_description_uses_top_level_type

printf '[✓] dshd proxy tests passed\n'
