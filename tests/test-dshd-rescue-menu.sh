#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "[FAIL] rescue test line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1 DSHD_STATE_DIR="$tmp/state"
mkdir -p "$DSHD_STATE_DIR"
source ./dshd
load_config
container_state() { printf 'running'; }
health_state() { printf 'healthy'; }
is_tty() { return 1; }

menu_render_main >"$tmp/main"
for category in '安装与实例' 'Web 管理修复' '紧急救援' '数据保护' '诊断与维护' '卸载当前实例'; do
  grep -Fq "$category" "$tmp/main"
done
for id in 01 02 03 04 05 06; do grep -Fq "[$id]" "$tmp/main"; done
! grep -Fq '配置与安全' "$tmp/main"
! grep -Fq '国际网络 / sing-box' "$tmp/main"
grep -Fq 'dshd menu legacy' "$tmp/main"
menu_render_legacy_main >"$tmp/legacy"
grep -Fq '配置与安全' "$tmp/legacy"
grep -Fq '国际网络' "$tmp/legacy"

for section in install web rescue backup doctor uninstall; do
  menu_render_rescue_category "$section" >"$tmp/$section"
  grep -Fq '[ 0] 返回' "$tmp/$section"
done
grep -Fq 'Web 执行器' "$tmp/web"
grep -Fq '回滚旧版容器' "$tmp/rescue"
grep -Fq '恢复数据' "$tmp/backup"
grep -Fq '逐项确认' "$tmp/uninstall"

# The default menu responds to EOF and does not enter advanced configuration.
printf '2\n1\n\n0\n0\n' | (
  cmd_web() { printf 'web-action:%s\n' "$1"; }
  menu
) >"$tmp/web-menu" 2>&1
grep -Fq 'web-action:status' "$tmp/web-menu"
! grep -Fq '修改完整配置' "$tmp/web-menu"

# All actions use existing host commands rather than replacement APIs.
(
  run_action() { printf '%s\n' "$*" >>"$tmp/routes"; }
  menu_rescue_action rescue 2
  menu_rescue_action rescue 4
  menu_rescue_action rescue 6
  menu_rescue_action rescue 7
  menu_rescue_action web 1
  menu_rescue_action backup 1
  menu_rescue_action backup 3
  menu_rescue_action doctor 1
  menu_rescue_action doctor 2
  menu_rescue_action doctor 3
) >"$tmp/routes.out"
for action in 'cmd_start' 'cmd_restart' 'cmd_rollback status' 'cmd_rollback apply' 'cmd_web status' 'cmd_backup' 'cmd_storage show' 'cmd_doctor' 'cmd_doctor_plugins' 'cmd_self_update'; do
  grep -Fxq "$action" "$tmp/routes"
done

# Risky actions decline by default when piped through a non-TTY.
(
  run_action() { echo "unexpected execution $*" >&2; return 77; }
  menu_rescue_action web 2
  menu_rescue_action web 3
  menu_rescue_action rescue 3
  menu_rescue_action backup 2
) >"$tmp/denied" 2>&1
! grep -q 'unexpected execution' "$tmp/denied"

# Uninstall MUST NOT touch dashboard, Docker, state or data before confirmation.
DSH_NAME=dsh-test
DSH_STORAGE_MODE=volume
DSH_VOLUME=dsh-test-data
DSH_WORKSPACE="$tmp/workspace"
load_config() { :; }
ensure_docker() { :; }
container_exists() { [[ "${removed:-0}" != 1 ]]; }
dashboard_container_exists() { return 0; }
docker_cmd() {
  printf '%s\n' "$*" >>"$tmp/docker-calls"
  if [[ "$1" == rm && "$3" == dsh-test ]]; then removed=1; fi
}
if cmd_uninstall >"$tmp/noninteractive" 2>&1; then
  echo 'noninteractive uninstall must fail closed' >&2; exit 1
fi
[[ ! -f "$tmp/docker-calls" ]]
is_tty() { return 0; }
confirm() { return 1; }
cmd_uninstall >"$tmp/cancelled" 2>&1
[[ ! -f "$tmp/docker-calls" ]]
counter=0
confirm() { counter=$((counter+1)); [[ "$counter" == 1 ]]; }
cmd_uninstall >"$tmp/deny-container" 2>&1
[[ ! -f "$tmp/docker-calls" ]]

# With both explicit confirmations, removal is ordered main container first,
# then Dashboard. Remaining data and configuration prompts are rejected.
counter=0
confirm() { counter=$((counter+1)); [[ "$counter" -le 2 ]]; }
search_remove_sidecar() { :; }
search_remove_network() { :; }
proxy_remove_sidecar() { :; }
proxy_remove_network() { :; }
docker_cmd() {
  printf '%s\n' "$*" >>"$tmp/docker-calls"
  if [[ "$1" == rm && "$3" == dsh-test ]]; then removed=1; fi
  if [[ "$1" == volume && "$2" == inspect ]]; then return 1; fi
}
cmd_uninstall >"$tmp/removed" 2>&1
head -2 "$tmp/docker-calls" >"$tmp/ordered"
grep -Fxq 'rm -f dsh-test' "$tmp/ordered"
[[ "$(head -1 "$tmp/ordered")" == 'rm -f dsh-test' ]]
[[ "$(tail -1 "$tmp/ordered")" == 'rm -f dsh-test-dashboard' ]]

# API compatibility remains: legacy mode is explicit and all cmd_* stay callable.
type menu_legacy menu_render_legacy_main cmd_update cmd_web_switch cmd_recreate cmd_proxy cmd_uninstall >/dev/null
bash -n dshd
printf '[OK] Phase 4 rescue console: old CLI retained, safe routing and uninstall order\n'
