#!/usr/bin/env bash
# dshd v0.11 navigation: compact home, category routing, no Docker dependency.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
export DSHD_STATE_DIR="$TMP/state"
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
mkdir -p "$HOME" "$DSHD_STATE_DIR"
source "$ROOT/dshd"
load_config

menu_render_main > "$TMP/home.txt"
for category in '实例管理' '运行管理' '版本与更新' '配置与安全' '网络与服务' '数据与维护'; do
  grep -Fq "$category" "$TMP/home.txt" || { echo "missing home category $category" >&2; exit 1; }
done
for number in 01 02 03 04 05 06; do
  grep -Fq "[$number]" "$TMP/home.txt"
done
! grep -Eq '\[(07|08|09|1[0-9]|2[0-9])\]' "$TMP/home.txt"
grep -Fq '[ 0] 退出' "$TMP/home.txt"
! grep -Fq $'\033[' "$TMP/home.txt"

for category in instances runtime versions config network data; do
  menu_render_category "$category" > "$TMP/category.txt"
  grep -Fq '[ 0] 返回主菜单' "$TMP/category.txt"
  grep -Fq '[01]' "$TMP/category.txt"
done
menu_render_category data > "$TMP/data.txt"
grep -Fq '卸载当前实例（危险）' "$TMP/data.txt"
menu_render_category config > "$TMP/config.txt"
grep -Fq 'Web 登录 Token 管理' "$TMP/config.txt"

# Never call Docker in dispatch coverage; all actions reuse existing names.
run_action() {
  printf 'called:%s\n' "$*" >> "$TMP/actions.txt"
}
: > "$TMP/actions.txt"
menu_category_action runtime 3
menu_category_action runtime 5
menu_category_action versions 1
menu_category_action versions 5
menu_category_action versions 6
menu_category_action versions 7
menu_category_action config 1
menu_category_action config 6 || [[ "$?" == 10 ]]
menu_category_action network 2 || [[ "$?" == 10 ]]
menu_category_action data 3
menu_category_action data 7
for command in 'cmd_stop' 'cmd_logs' 'cmd_update' 'cmd_rollback status' \
  'cmd_rollback apply' 'cmd_rollback clear' 'cmd_config' 'cmd_token_menu' \
  'cmd_search_menu' 'cmd_backup' 'cmd_uninstall'; do
  grep -Fxq "called:$command" "$TMP/actions.txt" || {
    echo "missing action route: $command" >&2; exit 1;
  }
done

# Invalid input redraws immediately and EOF exits both levels.
printf 'bad\n1\n0\n0\n' | menu > "$TMP/navigation.txt" 2> "$TMP/navigation.err"
grep -Fq '无效选项' "$TMP/navigation.err"
[[ "$(grep -Fc '◆ DSH Manager' "$TMP/navigation.txt")" == 3 ]]
timeout 5 bash -c '
  export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
  source "$1/dshd"
  menu </dev/null
' bash "$ROOT" > "$TMP/eof.txt" 2>&1

# Named-instance context must still discover the same shared registry.
mkdir -p "$DSHD_STATE_DIR/instances/study" "$DSHD_STATE_DIR/instances/other"
printf 'DSHD_INSTANCE_ID=study\nDSH_NAME=dsh-study\n' > "$DSHD_STATE_DIR/instances/study/config.env"
printf 'DSHD_INSTANCE_ID=other\nDSH_NAME=dsh-other\n' > "$DSHD_STATE_DIR/instances/other/config.env"
env DSHD_INSTANCE_ID=study DSHD_STATE_DIR="$DSHD_STATE_DIR/instances/study" \
  DSHD_LIB_ONLY=1 ROOT="$ROOT" SHARED_DIR="$DSHD_STATE_DIR" /bin/bash -c '
  source "$ROOT/dshd"
  [[ "$INSTANCE_ROOT_STATE_DIR" == "$SHARED_DIR" ]]
  [[ "$(instance_config_dir other)" == "$SHARED_DIR/instances/other" ]]
  cmd_instances | grep -Fq other
'

bash -n "$ROOT/dshd"
printf 'dshd navigation tests passed\n'
