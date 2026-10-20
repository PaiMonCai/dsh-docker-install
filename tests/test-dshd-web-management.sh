#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1 DSHD_STATE_DIR="$tmp/state"
mkdir -p "$DSHD_STATE_DIR"
source ./dshd
[[ "$(sha256sum docker/dsh-web-manager.py | cut -d' ' -f1)" == "$WEB_WORKER_SHA256" ]]
load_config
for target in /run /run/dsh-management /run/dsh-management/results; do
  if validate_custom_mount "$tmp/override" "$target" rw; then
    echo 'Custom mount can mask the management channel.' >&2; exit 1
  fi
done
DSH_NAME=dsh-test
DSH_WORKSPACE="$tmp/workspace"
DSH_STORAGE_MODE=bind
DSH_DATA_DIR="$tmp/data"
DSH_DOCKER_ACCESS=false
DEEPSEEK_API_KEY=PRIVATE_TEST_KEY
DEEPSEEK_BASE_URL=https://private.example.com

cmd_web describe >"$tmp/description"
! grep -aq PRIVATE_TEST_KEY "$tmp/description"
! grep -aq private.example.com "$tmp/description"
grep -aq dsh-test "$tmp/description"
grep -aq 'researchPack' "$tmp/description"
grep -aq 'storageMode' "$tmp/description"
grep -aq 'apiKeyConfigured' "$tmp/description"
! grep -aq 'PRIVATE_TEST_KEY' "$tmp/description"
[[ "$(web_service_name)" == "$(web_service_name)" ]]
[[ "$(web_systemd_quote '/etc/test%name')" == '"/etc/test%%name"' ]]

ensure_storage() { mkdir -p "$DSH_DATA_DIR"; }
container_exists() { return 1; }
wait_ready() { return 0; }
proxy_remove_sidecar() { :; }
proxy_remove_network() { :; }
docker_cmd() { printf '%s\n' "$@" >"$tmp/docker-args"; }
create_container
! grep -q /run/dsh-management "$tmp/docker-args"
mkdir -p "$STATE_DIR/web-management/requests" "$STATE_DIR/web-management/results"
touch "$STATE_DIR/web-management.enabled"
create_container
grep -Fxq "type=bind,src=$STATE_DIR/web-management/requests,dst=/run/dsh-management/requests" "$tmp/docker-args"
grep -Fxq "type=bind,src=$STATE_DIR/web-management/results,dst=/run/dsh-management/results,readonly" "$tmp/docker-args"
! grep -q docker.sock "$tmp/docker-args"
! grep -q "src=$STATE_DIR,dst=" "$tmp/docker-args"

# A browser-confirmed operation may run unattended; ordinary CLI defaults remain.
if confirm 'test' N </dev/null; then echo 'noninteractive confirmation unexpectedly accepted' >&2; exit 1; fi
DSHD_WEB_CONFIRMED=1 confirm 'test' N </dev/null

# Web restarts report readiness failures instead of a misleading success.
load_config() { :; }
ensure_docker() { :; }
container_exists() { return 0; }
wait_upgrade_healthy() { printf 'checked\n' >"$tmp/health"; }
DSHD_WEB_CONFIRMED=1 cmd_restart
[[ -f "$tmp/health" ]]
wait_upgrade_healthy() { return 1; }
if DSHD_WEB_CONFIRMED=1 cmd_restart >"$tmp/restart.out" 2>&1; then
  echo 'Web restart ignored a failed healthcheck' >&2; exit 1
fi

printf '[OK] dshd Web bridge mounts, metadata and unattended confirmation\n'
