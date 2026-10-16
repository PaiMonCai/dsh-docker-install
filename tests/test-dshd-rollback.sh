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
declare -A mock_owner=() mock_image_kept=()
mock_rm_failure=''
mock_image_failure=''
calls="$tmp/docker-calls"
saved=0
load_config() { :; }
ensure_docker() { :; }
confirm() { return 0; }
save_config() { echo save_config >>"$calls"; saved=$((saved+1)); }
container_exists() { [[ -n "${mock_existing[$DSH_NAME]:-}" ]]; }
container_running() { [[ "${mock_running[$DSH_NAME]:-0}" == 1 ]]; }
health_state() { [[ "${mock_running[$DSH_NAME]:-0}" == 1 ]] && printf healthy || printf unhealthy; }
docker_cmd() {
  echo "$*" >>"$calls"
  local op="$1"; shift
  case "$op" in
    inspect)
      if [[ "$1" == -f ]]; then
        local format="$2"
        shift 2; [[ -n "${mock_existing[$1]:-}" ]] || return 1
        case "$format" in
          '{{.Image}}') printf '%s\n' "${mock_image[$1]}" ;;
          '{{.State.Running}}') [[ "${mock_running[$1]:-0}" == 1 ]] && echo true || echo false ;;
          '{{index .Config.Labels "io.caicailo.dsh.instance"}}') printf '%s\n' "${mock_owner[$1]:-}" ;;
          *) echo "unexpected inspect format: $format" >&2; return 1 ;;
        esac
      else [[ -n "${mock_existing[$1]:-}" ]]; fi ;;
    stop) [[ -n "${mock_existing[$1]:-}" ]] || return 1; mock_running[$1]=0 ;;
    start) [[ -n "${mock_existing[$1]:-}" ]] || return 1; mock_running[$1]=1 ;;
    rename)
      [[ -n "${mock_existing[$1]:-}" && -z "${mock_existing[$2]:-}" ]] || return 1
      mock_existing[$2]=1
      mock_running[$2]="${mock_running[$1]}"
      mock_image[$2]="${mock_image[$1]}"
      mock_owner[$2]="${mock_owner[$1]:-}"
      unset 'mock_existing[$1]' 'mock_running[$1]' 'mock_image[$1]' 'mock_owner[$1]'
      ;;
    run)
      mock_existing[dsh]=1
      mock_running[dsh]=1
      mock_image[dsh]=candidate-sha
      ;;
    rm)
      local force=0
      if [[ "$1" == -f ]]; then force=1; shift; fi
      [[ -n "${mock_existing[$1]:-}" ]] || return 1
      [[ "$1" != "$mock_rm_failure" ]] || return 1
      [[ "$force" == 1 || "${mock_running[$1]:-0}" == 0 ]] || return 1
      unset 'mock_existing[$1]' 'mock_running[$1]' 'mock_image[$1]' 'mock_owner[$1]'
      ;;
    image)
      [[ "$1" == rm && "$2" == --no-prune && "$#" == 3 ]] || return 1
      local name
      for name in "${!mock_existing[@]}"; do
        [[ "${mock_image[$name]}" != "$3" ]] || return 1
      done
      [[ -z "${mock_image_kept[$3]:-}" && "$3" != "$mock_image_failure" ]] || return 1
      echo "$3" >>"$tmp/removed-images"
      ;;
    *) echo "unexpected docker call: $op $*" >&2; return 1 ;;
  esac
}

cmd_rollback apply >"$tmp/out"
[[ "${mock_image[dsh]}" == old-sha ]]
[[ "${mock_image[dsh-rollback-failed]}" == new-sha ]]
[[ "${mock_running[dsh]}" == 1 ]]
[[ "${mock_running[dsh-rollback-failed]}" == 0 ]]
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
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
[[ -n "${mock_existing[dsh]:-}" ]]
[[ -z "${mock_existing[dsh-rollback-failed]:-}" ]]
grep -Fxq older-sha "$tmp/removed-images"
grep -Fxq new-sha "$tmp/removed-images"

mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=first-sha
restore_previous_dsh_container dsh-rollback >"$tmp/out"
[[ "${mock_image[dsh]}" == first-sha ]]
[[ "${mock_running[dsh]}" == 1 ]]
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
[[ -z "${mock_existing[dsh-rollback-failed]:-}" ]]

real_create_container="$(declare -f create_container)"
pull_best_image() { DSH_IMAGE=new-sha; }
create_container() { [[ "${DSHD_SAFE_UPGRADE:-0}" == 1 ]] && return 1; }
prev_saved="$saved"
if cmd_update >"$tmp/out" 2>&1; then
  echo "expected failed update to return nonzero" >&2; exit 1
fi
[[ "$saved" == "$prev_saved" ]]
create_container() { [[ "${DSHD_SAFE_UPGRADE:-0}" == 1 ]]; }
cmd_update >"$tmp/out"
[[ "$saved" == $((prev_saved+1)) ]]

mock_running[dsh]=1
health_state() { printf unhealthy; }
if wait_upgrade_healthy >"$tmp/out" 2>&1; then
  echo "unhealthy container unexpectedly passed upgrade check" >&2; exit 1
fi

eval "$real_create_container"
# Integration-level failure: create_container stages the old Docker container,
# brings up a mock candidate, then fails its health gate and restores old dsh.
unset 'mock_existing[dsh-rollback-failed]' 'mock_running[dsh-rollback-failed]' \
  'mock_image[dsh-rollback-failed]'
DSH_IMAGE=candidate-sha
DSH_SHM_SIZE=1g
DSH_BIND_ADDR=127.0.0.1
DSH_PORT=3080
DSH_TRUSTED_HOSTS=''
DSHW_ADMIN_HOSTS=''
DSH_TIMEZONE=Asia/Shanghai
DSH_NPM_CACHE=/tmp/npm-cache
DSH_SEARCH_ENABLED=false
DSH_SEARCH_BRAVE_ENABLED=false
DSH_SEARCH_CACHE_ENABLED=true
DSH_SEARCH_BRAVE_DAILY_LIMIT=0
DSH_PROXY_ENABLED=false
DSH_WORKSPACE="$tmp/workspace"
DSH_STORAGE_MODE=bind
DSH_DATA_DIR="$tmp/data"
DSH_MEMORY_LIMIT=''
DSH_MEMORY_SWAP=''
DSH_DOCKER_ACCESS=false
DEEPSEEK_API_KEY=''
DEEPSEEK_BASE_URL=''
mkdir -p "$DSH_WORKSPACE" "$DSH_DATA_DIR"
touch "$tmp/persistent-session"
ensure_storage() { :; }
storage_source() { printf '%s\n' "$DSH_DATA_DIR"; }
storage_label() { printf 'unmodified-test-volume'; }
proxy_remove_sidecar() { :; }
proxy_remove_network() { :; }
search_remove_sidecar() { :; }
search_remove_network() { :; }
wait_ready() { return 0; }
wait_upgrade_healthy() { return 1; }
if DSHD_SAFE_UPGRADE=1 create_container >"$tmp/out" 2>&1; then
  echo 'health-failed candidate was accepted' >&2; exit 1
fi
[[ "${mock_image[dsh]}" == first-sha ]]
[[ "${mock_running[dsh]}" == 1 ]]
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
[[ -f "$tmp/persistent-session" ]]
! grep -Eq 'volume rm|rm .* -v' "$calls"

# Existing rollback points survive a failed next upgrade, including its images.
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=historical-sha
before_images="$(cat "$tmp/removed-images")"
if cmd_update >"$tmp/out" 2>&1; then
  echo 'health-failed upgrade with existing rollback was accepted' >&2; exit 1
fi
[[ "${mock_image[dsh]}" == first-sha ]]
[[ "${mock_image[dsh-rollback]}" == historical-sha ]]
[[ -z "${mock_existing[dsh-rollback-pending]:-}" ]]
[[ "$(cat "$tmp/removed-images")" == "$before_images" ]]

# A healthy upgrade saves config before removing both old generations and a
# failed candidate. Only their now-unused images are eligible for removal.
mock_existing[dsh-rollback-failed]=1
mock_running[dsh-rollback-failed]=0
mock_image[dsh-rollback-failed]=failed-sha
wait_upgrade_healthy() { echo healthy >>"$calls"; return 0; }
health_state() { printf healthy; }
: >"$calls"
cmd_update >"$tmp/out"
[[ "${mock_image[dsh]}" == candidate-sha ]]
for name in dsh-rollback dsh-rollback-pending dsh-rollback-failed; do
  [[ -z "${mock_existing[$name]:-}" ]]
done
for image in first-sha historical-sha failed-sha; do
  grep -Fxq "$image" "$tmp/removed-images"
done
! grep -Fxq candidate-sha "$tmp/removed-images"
awk '/^save_config$/ { saved=1 } /^rm dsh-rollback/ { if (!saved) exit 1; cleaned=1 } END { if (!cleaned) exit 1 }' "$calls"
[[ -f "$tmp/persistent-session" ]]
# An equal-image update must remove the old container without removing the
# image backing the replacement, and repeated updates must not need clear.
cmd_update >"$tmp/out"
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
! grep -Fxq candidate-sha "$tmp/removed-images"
cmd_recreate >"$tmp/out"
[[ -z "${mock_existing[dsh-rollback]:-}" ]]

# Cleanup failure is reported, but must not turn a healthy, saved update into a
# failure or trigger a rollback of the new application.
mock_rm_failure=dsh-rollback
cmd_update >"$tmp/out" 2>&1
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
[[ "${mock_running[dsh]}" == 1 ]]
grep -Fq '部分旧资源保留' "$tmp/out"
mock_rm_failure=''
cleanup_upgrade_artifacts manual >"$tmp/out"

# Keeping a manual rollback point is explicit; occupying its slot still blocks
# the next update without changing any containers.
DSHD_KEEP_ROLLBACK=1 cmd_update >"$tmp/out"
[[ "${mock_image[dsh-rollback]}" == candidate-sha ]]
if DSHD_KEEP_ROLLBACK=1 cmd_update >"$tmp/out" 2>&1; then
  echo 'retained rollback point was silently overwritten' >&2; exit 1
fi
cmd_update >"$tmp/out"
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
if DSHD_KEEP_ROLLBACK=invalid cmd_update >"$tmp/out" 2>&1; then
  echo 'invalid retention switch was accepted' >&2; exit 1
fi

# Save failure must preserve rollback resources even with a healthy new app.
real_save_config="$(declare -f save_config)"
save_config() { return 1; }
before_images="$(cat "$tmp/removed-images")"
if cmd_update >"$tmp/out" 2>&1; then
  echo 'config-save failure was ignored' >&2; exit 1
fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
[[ "$(cat "$tmp/removed-images")" == "$before_images" ]]
eval "$real_save_config"
cmd_update >"$tmp/out"

# Cleanup cannot stop running backups, cross instance ownership, remove data,
# force-remove shared/multi-tag images or expand to unrelated Docker resources.
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=1
mock_image[dsh-rollback]=running-sha
if cleanup_upgrade_artifacts manual >"$tmp/out" 2>&1; then exit 1; fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
mock_running[dsh-rollback]=0
mock_owner[dsh-rollback]=another-instance
if cleanup_upgrade_artifacts manual >"$tmp/out" 2>&1; then exit 1; fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
mock_owner[dsh-rollback]=''
mock_existing[other-instance]=1
mock_running[other-instance]=0
mock_image[other-instance]=running-sha
if cleanup_upgrade_artifacts manual >"$tmp/out" 2>&1; then exit 1; fi
[[ -z "${mock_existing[dsh-rollback]:-}" ]]
[[ -n "${mock_existing[other-instance]:-}" ]]
! grep -Fxq running-sha "$tmp/removed-images"
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=tagged-sha
mock_image_kept[tagged-sha]=1
if cleanup_upgrade_artifacts manual >"$tmp/out" 2>&1; then exit 1; fi
! grep -Fxq tagged-sha "$tmp/removed-images"
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=retry-sha
mock_rm_failure=dsh-rollback
if cleanup_upgrade_artifacts manual >"$tmp/out" 2>&1; then exit 1; fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
! grep -Fxq retry-sha "$tmp/removed-images"
mock_rm_failure=''
health_state() { printf unhealthy; }
if cleanup_upgrade_artifacts automatic >"$tmp/out" 2>&1; then exit 1; fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
health_state() { printf healthy; }
cleanup_upgrade_artifacts automatic >"$tmp/out"
grep -Fxq retry-sha "$tmp/removed-images"

# A leftover pending slot is evidence of an interrupted update. Refuse to
# replace the active service until it has been inspected, even in auto mode.
for name in dsh-rollback dsh-rollback-pending; do
  mock_existing[$name]=1
  mock_running[$name]=0
  mock_image[$name]=interrupted-sha
done
: >"$calls"
if cmd_update >"$tmp/out" 2>&1; then
  echo 'occupied pending slot was overwritten' >&2; exit 1
fi
! grep -Eq '^(stop|rename|rm|run|image) ' "$calls"
cleanup_upgrade_artifacts manual >"$tmp/out"

# A failed pull cannot clean up even a stopped, otherwise eligible rollback.
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=pull-backup-sha
pull_best_image() { return 1; }
if cmd_update >"$tmp/out" 2>&1; then
  echo 'failed image pull was accepted' >&2; exit 1
fi
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
! grep -Fxq pull-backup-sha "$tmp/removed-images"
cleanup_upgrade_artifacts manual >"$tmp/out"

# Reverse and named instances only clean their own full container names and
# require the matching owner label, leaving Standard and other instances alone.
mock_existing[dsh-rollback]=1
mock_running[dsh-rollback]=0
mock_image[dsh-rollback]=standard-backup-sha
DSH_NAME=dsh-reverse
DSHD_INSTANCE_ID=reverse
for name in dsh-reverse dsh-reverse-rollback; do
  mock_existing[$name]=1
  mock_image[$name]=reverse-old-sha
  mock_owner[$name]=reverse
  mock_running[$name]=0
done
mock_running[dsh-reverse]=1
mock_image[dsh-reverse]=reverse-current-sha
cleanup_upgrade_artifacts automatic >"$tmp/out"
[[ -z "${mock_existing[dsh-reverse-rollback]:-}" ]]
[[ -n "${mock_existing[dsh-rollback]:-}" ]]
[[ -n "${mock_existing[dsh-reverse]:-}" ]]
grep -Fxq reverse-old-sha "$tmp/removed-images"
! grep -Fxq standard-backup-sha "$tmp/removed-images"
! grep -Eq 'volume rm|system prune|image prune|image rm .*--force|rm .* -v' "$calls"

# Exercise the real config writer in a conditional (where Bash disables
# errexit): permission/write errors must still propagate before cleanup.
(
  source ./dshd
  load_config
  save_config
  cp "$CONFIG_FILE" "$tmp/config-before"
  ensure_state_dir() { :; }
  chmod() { return 1; }
  if save_config >"$tmp/out" 2>&1; then
    echo 'config permission failure was ignored' >&2; exit 1
  fi
  cmp "$CONFIG_FILE" "$tmp/config-before"
  mktemp() { printf '%s\n' "$tmp/missing/config"; }
  if save_config >"$tmp/out" 2>&1; then
    echo 'config write failure was ignored' >&2; exit 1
  fi
  cmp "$CONFIG_FILE" "$tmp/config-before"
)
echo "Transactional update and non-destructive rollback tests passed"
