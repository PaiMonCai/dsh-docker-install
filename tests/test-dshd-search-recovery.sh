#!/usr/bin/env bash
# Exercise real SearXNG secret generation and the enable transaction without Docker.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
export DSHD_STATE_DIR="$TMP/state"
export DSHD_CONFIG_FILE="$TMP/state/config.env"
export DSHD_CONTAINER_ENV_FILE="$TMP/state/container.env"
export DSHD_BACKUP_DIR="$TMP/state/backups"
export DSHD_MOUNTS_FILE="$TMP/state/mounts.conf"
mkdir -p "$DSHD_STATE_DIR"
source "$ROOT/dshd"
load_config
DSH_SEARCH_ENABLED=false
save_config

# Real entropy source (od): 32 bytes must produce exactly 64 lowercase hex
# characters, even when od wraps output across multiple newline-separated rows.
search_ensure_config
settings="$(search_dir)/searxng/settings.yml"
[[ -f "$settings" ]] || { echo "SearXNG settings missing" >&2; exit 1; }
grep -Eq '^  secret_key: "[a-f0-9]{64}"$' "$settings" || { echo "invalid SearXNG secret" >&2; exit 1; }
grep -Fq '    - json' "$settings" || { echo "JSON search not enabled" >&2; exit 1; }
[[ "$(stat -c %a "$settings")" == 600 ]] || { echo "SearXNG settings must be mode 600" >&2; exit 1; }
previous="$(grep -E '^  secret_key:' "$settings")"
search_ensure_config
[[ "$(grep -E '^  secret_key:' "$settings")" == "$previous" ]] || { echo "secret changed on retry" >&2; exit 1; }

# Fail the setup before any Docker container is replaced; the saved opt-in flag
# must remain false, so the next menu run can retry instead of falsely skipping.
create_container() {
  [[ "$DSH_SEARCH_ENABLED" == true ]] || { echo "staged flag missing" >&2; return 2; }
  printf 'fail\n' >> "$TMP/create-calls"
  return 27
}
set +e
( set -e; cmd_search enable ) >"$TMP/failed.stdout" 2>"$TMP/failed.stderr"
rc=$?
set -e
[[ "$rc" == 27 ]] || { echo "expected setup failure 27, got $rc" >&2; exit 1; }
grep -Fxq 'DSH_SEARCH_ENABLED=false' "$DSHD_CONFIG_FILE" || { echo "failed setup persisted enabled flag" >&2; exit 1; }
load_config
[[ "$DSH_SEARCH_ENABLED" == false ]] || { echo "failed setup changed loaded flag" >&2; exit 1; }


# The actual menu uses run_action, which deliberately swallows failed commands.
# Verify that the command itself returns on failure rather than saving the
# false-positive opt-in flag after a failed create_container().
rm -f "$TMP/create-calls"
run_action cmd_search enable >"$TMP/menu-fail.stdout" 2>"$TMP/menu-fail.stderr"
grep -Fq '本次操作未完成' "$TMP/menu-fail.stderr" || { echo "menu must report failed create" >&2; exit 1; }
grep -Fxq 'DSH_SEARCH_ENABLED=false' "$DSHD_CONFIG_FILE" || { echo "menu failure saved enabled" >&2; exit 1; }

# Simulate a repaired retry, then verify settings are written only once setup
# has reported success and that the existing secure secret is preserved.
create_container() {
  [[ "$DSH_SEARCH_ENABLED" == true ]] || { echo "missing staged flag" >&2; return 2; }
  grep -Fxq 'DSH_SEARCH_ENABLED=false' "$DSHD_CONFIG_FILE" || { echo "flag saved before create" >&2; return 2; }
  printf 'ok\n' >> "$TMP/create-calls"
}
cmd_search enable >"$TMP/retry.stdout"
grep -Fxq 'DSH_SEARCH_ENABLED=true' "$DSHD_CONFIG_FILE" || { echo "successful retry not saved" >&2; exit 1; }
[[ "$(grep -E '^  secret_key:' "$settings")" == "$previous" ]] || { echo "successful retry rotated secret" >&2; exit 1; }
[[ "$(cat "$TMP/create-calls")" == $'fail\nok' ]] || { echo "retry did not call create" >&2; exit 1; }
echo "test-dshd-search-recovery: ok"
