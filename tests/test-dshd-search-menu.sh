#!/usr/bin/env bash
# [28] Web Search menu routing, persistence boundaries, errors and EOF.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
export DSHD_STATE_DIR="$TMP/state"
export DSHD_CONFIG_FILE="$TMP/state/config.env"
export DSHD_BACKUP_DIR="$TMP/state/backups"
export DSHD_MOUNTS_FILE="$TMP/state/mounts.conf"
export DSHD_CONTAINER_ENV_FILE="$TMP/state/container.env"
mkdir -p "$DSHD_STATE_DIR"
source "$ROOT/dshd"
load_config
DSH_SEARCH_ENABLED=false
DSH_SEARCH_BRAVE_ENABLED=false
DSH_SEARCH_CACHE_ENABLED=false
DSH_SEARCH_BRAVE_DAILY_LIMIT=50
save_config

export SEARCH_TEST_LOG="$TMP/actions.log"
: > "$SEARCH_TEST_LOG"
# Mock the CLI command, NOT the menu handler. Real cmd_search owns Docker state.
# Persist toggle changes because run_action executes commands in a subshell.
cmd_search() {
  printf '%s\n' "$*" >>"$SEARCH_TEST_LOG"
  load_config
  case "$*" in
    enable) DSH_SEARCH_ENABLED=true; save_config ;;
    disable) DSH_SEARCH_ENABLED=false; save_config ;;
    "brave enable") DSH_SEARCH_BRAVE_ENABLED=true; save_config ;;
    "brave disable") DSH_SEARCH_BRAVE_ENABLED=false; save_config ;;
    "brave limit "*) DSH_SEARCH_BRAVE_DAILY_LIMIT="$3"; save_config ;;
    "cache on") DSH_SEARCH_CACHE_ENABLED=true; save_config ;;
    "cache off") DSH_SEARCH_CACHE_ENABLED=false; save_config ;;
    test) return 27 ;;
  esac
}
search_container_running() { return 1; }
docker_cmd() { return 1; }
container_exists() { return 1; }
container_running() { return 1; }
confirm() { printf 'confirmation\n' >>"$TMP/confirms.log"; return 0; }
menu_colors_enabled() { return 1; }

# Every selectable action, invalid quota followed by a valid padded decimal,
# a failing search test, and one invalid menu key.
printf 'bad\n1\n\n2\n\n3\n\n4\n\n5\n\n6\n\n7\n\n8\n\n9\n\n10\ninvalid\n10001\n00008\n\n11\n\n12\n\n13\n\n0\n' \
  | cmd_search_menu >"$TMP/search-menu.out" 2>"$TMP/search-menu.err"
for action in "enable" "disable" "test" "doctor" "logs" "restart" "update" \
              "brave enable" "brave disable" "brave limit 8" "cache on" "cache off" "cache clear"; do
  grep -Fxq "$action" "$SEARCH_TEST_LOG" || {
    printf '[x] missing search menu action: %s\n' "$action" >&2
    cat "$SEARCH_TEST_LOG" >&2
    exit 1
  }
done
[[ "$(wc -l <"$SEARCH_TEST_LOG")" == 13 ]] || {
  echo 'unexpected duplicate search operation' >&2; cat "$SEARCH_TEST_LOG"; exit 1;
}
grep -Fq '本次操作未完成' "$TMP/search-menu.err" || { echo 'action failure must remain in submenu' >&2; exit 1; }
grep -Fq '无效选项' "$TMP/search-menu.err" || { echo 'invalid selection should retry' >&2; exit 1; }
[[ "$(grep -Fc '请输入 0–10000' "$TMP/search-menu.err")" == 2 ]] || { echo 'invalid quota should retry twice' >&2; exit 1; }
grep -Fq '每天最多 8 次' "$TMP/search-menu.out" || { echo 'quota should refresh from persisted config' >&2; exit 1; }
grep -Fq 'Brave API Key 请在 DSH Web' "$TMP/search-menu.out" || { echo 'credential help missing' >&2; exit 1; }
grep -Fq 'Web Search / SearXNG 管理' "$TMP/search-menu.out" || { echo 'submenu missing' >&2; exit 1; }
if grep -Fq $'\033[' "$TMP/search-menu.out"; then
  echo 'redirected submenu should have no ANSI escapes' >&2; exit 1
fi

# Declining confirmations must not call mutating CLI commands.
: >"$SEARCH_TEST_LOG"
DSH_SEARCH_ENABLED=true
DSH_SEARCH_BRAVE_ENABLED=false
save_config
confirm() { return 1; }
printf '2\n\n7\n\n8\n\n13\n\n0\n' | cmd_search_menu >"$TMP/declined.out"
[[ ! -s "$SEARCH_TEST_LOG" ]] || { echo 'declined operation still executed' >&2; exit 1; }

# Main menu 28 enters submenu, then returns directly without an extra pause.
# Avoid actual Docker calls in status rendering.
: >"$SEARCH_TEST_LOG"
printf '28\n0\n0\n' | menu >"$TMP/main-menu.out" 2>"$TMP/main-menu.err"
grep -Fq '[28] Web Search / SearXNG' "$TMP/main-menu.out" || { echo 'main menu entry missing' >&2; exit 1; }
grep -Fq 'Web Search / SearXNG 管理' "$TMP/main-menu.out" || { echo '28 did not enter submenu' >&2; exit 1; }
[[ "$(grep -Fc '◆ DSH / Docker Manager' "$TMP/main-menu.out")" == 2 ]] || { echo 'submenu returned to main with wrong input consumption' >&2; exit 1; }
[[ ! -s "$SEARCH_TEST_LOG" ]] || { echo 'navigation should not trigger any search operation' >&2; exit 1; }

# EOF must immediately exit rather than spinning, including quota prompt.
timeout 5 bash -c '
  export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
  source "$1/dshd"
  cmd_search_menu </dev/null
' bash "$ROOT" >"$TMP/eof.out" 2>&1 || { echo 'search submenu EOF should not hang' >&2; exit 1; }
printf '10\n' | cmd_search_menu >"$TMP/quota-eof.out" 2>&1 || { echo 'quota input EOF should not hang' >&2; exit 1; }
echo 'test-dshd-search-menu: ok'
