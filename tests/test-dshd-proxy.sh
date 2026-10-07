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
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  [[ "$DSH_PROXY_FAILOVER_ENABLED" == "false" ]] || fail "failover should default to disabled"
  [[ "$DSH_PROXY_FAILOVER_INTERVAL" == "30s" ]] || fail "unexpected failover interval"
  [[ "$DSH_PROXY_FAILOVER_TOLERANCE" == "100" ]] || fail "unexpected failover tolerance"

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
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  DSH_PROXY_FAILOVER_ENABLED=true
  DSH_PROXY_FAILOVER_INTERVAL=45s
  DSH_PROXY_FAILOVER_TOLERANCE=150
  save_config

  grep -q '^DSH_PROXY_ENABLED=true$' "$CONFIG_FILE" || fail "proxy enabled flag not persisted"
  grep -q '^DSH_PROXY_NODE=jp01$' "$CONFIG_FILE" || fail "proxy node not persisted"
  grep -q '^DSH_PROXY_PORT=17890$' "$CONFIG_FILE" || fail "proxy port not persisted"
  grep -q '^DSH_PROXY_IMAGE=example.invalid/sing-box:test$' "$CONFIG_FILE" || fail "proxy image not persisted"
  grep -q '^DSH_PROXY_FAILOVER_ENABLED=true$' "$CONFIG_FILE" || fail "failover enabled not persisted"
  grep -q '^DSH_PROXY_FAILOVER_INTERVAL=45s$' "$CONFIG_FILE" || fail "failover interval not persisted"
  grep -q '^DSH_PROXY_FAILOVER_TOLERANCE=150$' "$CONFIG_FILE" || fail "failover tolerance not persisted"
)

test_active_node_switch_does_not_recreate_dsh() (
  local tmp
  tmp="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  local tmp raw_file base64_file encoded source_file
  tmp="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
  proxy_import_subscription "$raw_file" work >/dev/null
  proxy_node_exists work-A || fail "named subscription should prefix VLESS node"
  proxy_node_exists work-B || fail "named subscription should prefix Trojan node"
  [[ "$DSH_PROXY_NODE" == "work-A" ]] || fail "first imported node should become current when none exists"
  [[ "$PROXY_IMPORT_FIRST_NAME" == "work-A" ]] || fail "first imported node should be exposed to wizard"
  proxy_subscription_exists work || fail "subscription source should persist"
  grep -Fxq 'work-A' "$(proxy_subscription_nodes_file work)" || fail "subscription membership missing work-A"
  grep -Fxq 'work-B' "$(proxy_subscription_nodes_file work)" || fail "subscription membership missing work-B"

  # An active subscription refresh must validate the staged current candidate before replace.
  DSH_PROXY_ENABLED=true
  save_config
  cat >"$raw_file" <<'EOF'
vless://11111111-1111-1111-1111-111111111111@broken.example.com:443?security=tls#A
EOF
  if (
    docker_cmd() {
      [[ "$1" == "image" && "$2" == "inspect" ]] && return 0
      return 0
    }
    proxy_validate_config_file() { return 1; }
    proxy_refresh_subscription work >/dev/null 2>&1
  ); then
    fail "failed staged validation must abort subscription refresh"
  fi
  grep -Fq '"server":"a.example.com"' "$(proxy_node_file work-A)" || fail "failed refresh must keep old node content"
  proxy_node_exists work-B || fail "failed refresh must keep all old subscription nodes"
  DSH_PROXY_ENABLED=false
  save_config

  base64_file="$tmp/base64-sub.txt"
  encoded="$(printf '%s\n%s\n' \
    'hysteria2://secret@hy.example.com:443?sni=hy.example.com#HY' \
    'ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#SS' \
    | base64 | tr -d '\n')"
  printf '%s' "$encoded" >"$base64_file"
  proxy_import_subscription "$base64_file" >/dev/null
  proxy_subscription_exists sub1 || fail "unnamed subscription should auto-name sub1"
  proxy_node_exists sub1-HY || fail "base64 subscription should import Hysteria2"
  proxy_node_exists sub1-SS || fail "base64 subscription should import Shadowsocks"
  [[ "$DSH_PROXY_NODE" == "work-A" ]] || fail "new subscription must not silently switch an existing current node"

  # Refresh the active subscription: keep stable names, remove vanished nodes, add new ones,
  # and reload sidecar without recreating DSH.
  DSH_PROXY_ENABLED=true
  save_config
  proxy_start_sidecar() { printf '%s\n' "$DSH_PROXY_NODE" >"$tmp/reloaded-sub-node"; }
  create_container() { fail "subscription refresh must not recreate DSH"; }

  cat >"$raw_file" <<'EOF'
vless://11111111-1111-1111-1111-111111111111@new-a.example.com:443?security=tls#A
hysteria2://newsecret@c.example.com:443?sni=c.example.com#C
EOF
  proxy_refresh_subscription work >/dev/null
  proxy_node_exists work-A || fail "refresh should preserve stable named node"
  ! proxy_node_exists work-B || fail "refresh should remove vanished subscription node"
  proxy_node_exists work-C || fail "refresh should add new subscription node"
  grep -Fq '"server":"new-a.example.com"' "$(proxy_node_file work-A)" || fail "refresh should replace node content"
  [[ "$(cat "$tmp/reloaded-sub-node")" == "work-A" ]] || fail "active subscription refresh should reload current sidecar"
  [[ "$DSH_PROXY_NODE" == "work-A" ]] || fail "active stable node should remain selected"

  # If the current node disappears, refresh chooses the first surviving imported node.
  cat >"$raw_file" <<'EOF'
trojan://replacement@z.example.com:443?security=tls#Z
EOF
  proxy_refresh_subscription work >/dev/null
  [[ "$DSH_PROXY_NODE" == "work-Z" ]] || fail "refresh should fall back when current subscription node vanished"
  [[ "$(cat "$tmp/reloaded-sub-node")" == "work-Z" ]] || fail "fallback subscription node should reload sidecar"

  source_file="$(proxy_subscription_source_file work)"
  [[ "$(cat "$source_file")" == "$raw_file" ]] || fail "subscription refresh source should persist"

  if (proxy_remove_subscription work >/dev/null 2>&1); then
    fail "active subscription should not be removable while proxy is enabled"
  fi
  proxy_subscription_exists work || fail "blocked unsubscribe must keep subscription"
  proxy_node_exists work-Z || fail "blocked unsubscribe must keep managed nodes"

  DSH_PROXY_ENABLED=false
  save_config
  proxy_remove_subscription work >/dev/null
  ! proxy_subscription_exists work || fail "unsubscribe should remove subscription metadata"
  ! proxy_node_exists work-Z || fail "unsubscribe should remove managed nodes"
  [[ -z "$DSH_PROXY_NODE" ]] || fail "unsubscribe should clear disabled current managed node"
)


test_proxy_benchmark_and_use_best() (
  local tmp
  tmp="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  proxy_write_url_node slow 'http://slow.example.com:8080' >/dev/null
  proxy_write_url_node fast 'http://fast.example.com:8080' >/dev/null
  proxy_write_url_node dead 'http://dead.example.com:8080' >/dev/null
  DSH_PROXY_NODE=slow
  DSH_PROXY_ENABLED=true
  save_config

  container_running() { return 0; }
  pull_proxy_image() { :; }
  proxy_ensure_network() { :; }
  proxy_cleanup_test_containers() { :; }
  proxy_network_has_container() { return 0; }
  proxy_measure_node() {
    case "$1" in
      fast)
        PROXY_MEASURE_STATUS=ok
        PROXY_MEASURE_MS=80
        PROXY_MEASURE_CODE=204
        return 0
        ;;
      slow)
        PROXY_MEASURE_STATUS=ok
        PROXY_MEASURE_MS=240
        PROXY_MEASURE_CODE=204
        return 0
        ;;
      *)
        PROXY_MEASURE_STATUS=fail
        PROXY_MEASURE_MS=""
        PROXY_MEASURE_CODE=000
        return 1
        ;;
    esac
  }
  create_container() { fail "benchmark/use-best must not recreate DSH"; }
  proxy_start_sidecar() { printf '%s\n' "$DSH_PROXY_NODE" >"$tmp/sidecar-node"; }

  proxy_test_all 'https://example.com/generate_204' >/dev/null
  [[ "$PROXY_TEST_BEST_NODE" == "fast" ]] || fail "benchmark should choose fast node"
  [[ "$PROXY_TEST_BEST_MS" == "80" ]] || fail "benchmark should retain best latency"
  [[ "$(proxy_last_result fast)" == "80ms" ]] || fail "last result should expose latency"
  [[ "$(proxy_last_result dead)" == "FAIL" ]] || fail "last result should expose failure"

  proxy_use_best 'https://example.com/generate_204' >/dev/null
  [[ "$DSH_PROXY_NODE" == "fast" ]] || fail "use-best should switch current node"
  [[ "$(cat "$tmp/sidecar-node")" == "fast" ]] || fail "use-best should reload sidecar with fast node"
)

test_failover_config_and_controls() (
  local tmp
  tmp="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  unset DSH_STORAGE_MODE DSH_DATA_DIR DSH_VOLUME DSH_WORKSPACE || true
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"
  load_config
  proxy_write_url_node primary 'http://primary.example.com:8080' >/dev/null
  proxy_write_url_node backup 'socks5://backup.example.com:1080' >/dev/null
  proxy_write_json_node third '{"type":"trojan","tag":"proxy","server":"third.example.com","server_port":443,"password":"test-pass","tls":{"enabled":true}}' >/dev/null

  DSH_PROXY_NODE=primary
  DSH_PROXY_FAILOVER_ENABLED=true
  DSH_PROXY_FAILOVER_URL='https://www.gstatic.com/generate_204'
  DSH_PROXY_FAILOVER_INTERVAL=30s
  DSH_PROXY_FAILOVER_TOLERANCE=100
  DSH_PROXY_FAILOVER_IDLE_TIMEOUT=30m
  DSH_PROXY_FAILOVER_INTERRUPT=false

  proxy_generate_config
  assert_json_file "$PROXY_CONFIG_FILE"
  grep -Fq '"type":"urltest","tag":"proxy"' "$PROXY_CONFIG_FILE" || fail "urltest group missing"
  grep -Fq '"outbounds":["member-1","member-2","member-3"]' "$PROXY_CONFIG_FILE" || fail "failover member list missing"
  grep -Fq '"interval":"30s"' "$PROXY_CONFIG_FILE" || fail "failover interval missing"
  grep -Fq '"tolerance":100' "$PROXY_CONFIG_FILE" || fail "failover tolerance missing"
  grep -Fq '"idle_timeout":"30m"' "$PROXY_CONFIG_FILE" || fail "failover idle timeout missing"
  grep -Fq '"interrupt_exist_connections":false' "$PROXY_CONFIG_FILE" || fail "failover interrupt policy missing"
  grep -Fq '"server":"primary.example.com"' "$PROXY_CONFIG_FILE" || fail "primary member missing"
  grep -Fq '"server":"backup.example.com"' "$PROXY_CONFIG_FILE" || fail "backup member missing"
  grep -Fq '"server":"third.example.com"' "$PROXY_CONFIG_FILE" || fail "third member missing"
  [[ "$(grep -o '"tag":"member-[0-9]*"' "$PROXY_CONFIG_FILE" | wc -l | tr -d ' ')" == "3" ]] || fail "all member tags should be unique"

  DSH_PROXY_ENABLED=false
  proxy_set_failover true >/dev/null
  grep -q '^DSH_PROXY_FAILOVER_ENABLED=true$' "$CONFIG_FILE" || fail "failover enable should persist"

  ensure_docker() { :; }
  if (cmd_proxy use backup >/dev/null 2>&1); then
    fail "manual use must be rejected while failover is enabled"
  fi

  proxy_set_failover false >/dev/null
  [[ "$DSH_PROXY_FAILOVER_ENABLED" == "false" ]] || fail "failover disable should update runtime state"
  grep -q '^DSH_PROXY_FAILOVER_ENABLED=false$' "$CONFIG_FILE" || fail "failover disable should persist"
)

test_nested_node_description_uses_top_level_type() (
  local tmp
  tmp="$(mktemp -d)"
  trap "rm -rf -- $(printf '%q' "$tmp")" EXIT
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
test_proxy_benchmark_and_use_best
test_failover_config_and_controls
test_nested_node_description_uses_top_level_type

printf '[✓] dshd proxy tests passed\n'
