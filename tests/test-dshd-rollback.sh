#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSHD_STATE_DIR="$tmp/state" DSHD_CONFIG_FILE="$tmp/state/config.env"
mkdir -p "$DSHD_STATE_DIR"
source ./dshd

DSH_NAME=dsh
DSH_IMAGE=new-image:current
declare -A mock_existing=( [dsh]=1 [dsh-rollback]=1 )
declare -A mock_running=( [dsh]=1 [dsh-rollback]=0 )
declare -A mock_image=( [dsh]=new-sha [dsh-rollback]=old-sha )
calls="$tmp/docker-calls"
saved=0
load_config() { :; }
ensure_docker() { :; }
confirm() { return 0; }
save_config() { saved=$((saved+1)); }
container_exists() { [[ -n "\${mock_existing[$DSH_NAME]:-}" ]]; }
container_running() { [[ "\${mock_running[$DSH_NAME]:-0}" == 1 ]]; }
health_state() { [[ "\${mock_running[$DSH_NAME]:-0}" == 1 ]] && printf healthy || printf unhealthy; }
docker_cmd() {
  echo "$*" >>"$calls"
  local op="$1"; shift
  case "$op" in
    inspect)
      if [[ "$1" == -f ]]; then
        shift 2; [[ -n "\${mock_existing[$1]:-}" ]] || return 1
        printf '%s\n' "\${mock_image[$1]}"
      else [[ -n "\${mock_existing[$1]:-}" ]]; fi ;;
    stop) [[ -n "\${mock_existing[$1]:-}" ]] || return 1; mock_running[$1]=0 ;;
    start) [[ -n "\${mock_existing[$1]:-}" ]] || return 1; mock_running[$1]=1 ;;
    rename)
      [[ -n "\${mock_existing[$1]:-}" && -z "\${mock_existing[$2]:-}" ]] || return 1
      mock_existing[$2]=1
      mock_running[$2]="\${mock_running[$1]}"
      mock_image[$2]="\${mock_image[$1]}"
      unset 'mock_existing[$1]' 'mock_running[$1]' 'mock_image[$1]'
      ;;
    rm)
      if [[ "$1" == -f ]]; then shift; fi
      [[ -n "\${mock_existing[$1]:-}" ]] || return 1
      unset 'mock_existing[$1]' 'mock_running[$1]' 'mock_image[$1]'
      ;;
    *) echo "unexpected docker call: $op $*" >&2; return 1 ;;
  esac
}

cmd_rollback apply >"$tmp/out"
[[ "\${mock_image[dsh]}" == old-sha ]]
[[ "\${mock_image[dsh-rollback-failed]}" == new-sha ]]
[[ "\${mock_running[dsh]}" == 1 ]]
[[ "\${mock_running[dsh-rollback-failed]}" == 0 ]]
[[ "$DSH_IMAGE" == old-sha ]]
[[ "$saved" == 1 ]]
! grep -Eq 'rm .* -v|volume rm|/root/\.dsh|/workspace' "$calls"

if cmd_rollback apply >"$tmp/out" 2>&1; then
  echo "expected missing rollback candidate to fail" >&2; exit 1
fi

mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=older-sha
cmd_rollback clear >"$tmp/out"
[[ -z "\${mock_existing[dsh-rollback]:-}" ]]
[[ -n "\${mock_existing[dsh]:-}" ]]

mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=first-sha
restore_previous_dsh_container dsh-rollback >"$tmp/out"
[[ "\${mock_image[dsh]}" == first-sha ]]
[[ "\${mock_running[dsh]}" == 1 ]]
[[ -z "\${mock_existing[dsh-rollback]:-}" ]]
[[ -n "\${mock_existing[dsh-rollback-failed]:-}" ]]

pull_best_image() { DSH_IMAGE=new-sha; }
create_container() { [[ "\${DSHD_SAFE_UPGRADE:-0}" == 1 ]] && return 1; }
prev_saved="$saved"
if cmd_update >"$tmp/out" 2>&1; then
  echo "expected failed update to return nonzero" >&2; exit 1
fi
[[ "$saved" == "$prev_saved" ]]
create_container() { [[ "\${DSHD_SAFE_UPGRADE:-0}" == 1 ]]; }
cmd_update >"$tmp/out"
[[ "$saved" == $((prev_saved+1)) ]]

mock_running[dsh]=1
health_state() { printf unhealthy; }
if wait_upgrade_healthy >"$tmp/out" 2>&1; then
  echo "unhealthy container unexpectedly passed upgrade check" >&2; exit 1
fi
echo "Transactional update and non-destructive rollback tests passed"
