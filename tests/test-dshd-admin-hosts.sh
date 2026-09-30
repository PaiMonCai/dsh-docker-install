#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export DSHD_LIB_ONLY=1
export DSHD_STATE_DIR="$TMP/state"
export DSHD_CONFIG_FILE="$TMP/state/config.env"
export DSHD_CONTAINER_ENV_FILE="$TMP/state/container.env"
export DSHD_BACKUP_DIR="$TMP/state/backups"

source "$ROOT/dshd"

DSH_EDITION=standard
DSH_RESEARCH_PACK=none
DSH_IMAGE=test-image
DSH_NAME=dsh-test
DSH_PORT=3080
DSH_BIND_ADDR=127.0.0.1
DSH_RESEARCH_DASHBOARD_PORT=8765
DSH_WORKSPACE="$TMP/workspace"
DSH_STORAGE_MODE=bind
DSH_DATA_DIR="$TMP/data"
DSH_VOLUME=dsh-test-home
DSH_SHM_SIZE=1g
DSH_TIMEZONE=Asia/Shanghai
DSH_NPM_CACHE=/tmp/npm-cache
DSH_MEMORY_LIMIT=""
DSH_MEMORY_SWAP=""
DSH_TRUSTED_HOSTS=dsh.example.com
DSHW_ADMIN_HOSTS=dsh.example.com
DEEPSEEK_BASE_URL=""
DEEPSEEK_API_KEY=""
DSH_DOCKER_ACCESS=false
DSH_DOCKER_SOCKET=/var/run/docker.sock

save_config
grep -Fxq 'DSHW_ADMIN_HOSTS=dsh.example.com' "$DSHD_CONFIG_FILE"

DSHW_ADMIN_HOSTS=""
load_config
[[ "$DSHW_ADMIN_HOSTS" == "dsh.example.com" ]]

grep -v '^DSHW_ADMIN_HOSTS=' "$DSHD_CONFIG_FILE" >"$DSHD_CONFIG_FILE.old"
mv "$DSHD_CONFIG_FILE.old" "$DSHD_CONFIG_FILE"
DSHW_ADMIN_HOSTS=""
load_config
[[ -z "$DSHW_ADMIN_HOSTS" ]]

[[ "$(normalize_admin_hosts 'dsh.example.com,dsh.example.com,admin.internal:3080')" == 'dsh.example.com,admin.internal:3080' ]]
[[ "$(admin_hosts_remove_values 'dsh.example.com,admin.internal:3080' 'dsh.example.com')" == 'admin.internal:3080' ]]

DSHW_ADMIN_HOSTS=dsh.example.com
CAPTURED_DOCKER_ARGS=""
container_exists() { return 1; }
ensure_storage() { mkdir -p "$DSH_DATA_DIR"; }
wait_ready() { return 0; }
docker_cmd() {
  CAPTURED_DOCKER_ARGS="$(printf '%q ' "$@")"
  return 0
}
create_container
[[ "$CAPTURED_DOCKER_ARGS" == *'DSHW_ADMIN_HOSTS=dsh.example.com'* ]]

printf 'test-dshd-admin-hosts: ok\n'
