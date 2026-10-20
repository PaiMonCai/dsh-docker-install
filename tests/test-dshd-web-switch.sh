#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1 DSHD_STATE_DIR="$tmp/state"
source ./dshd

# Every Docker action is a mock. Never touch a real instance.
load_config() { :; }
ensure_docker() { :; }
ensure_rollback_slot_free() { :; }
container_exists() { return 0; }
upgrade_rollback_name() { printf '%s\n' 'dsh-test-rollback'; }
restore_previous_dsh_container() { [[ "$1" == dsh-test-rollback ]]; restored=1; }
finish_safe_upgrade() { cleaned=$((cleaned + 1)); }
pull_best_image() {
  if [[ "\${FAIL_PULL:-0}" == 1 ]]; then return 1; fi
  DSH_IMAGE="fixture-$DSH_EDITION-$DSH_RESEARCH_PACK"
}
create_container() {
  [[ "\${DSHD_SAFE_UPGRADE:-0}" == 1 ]] || return 1
  created=$((created + 1))
  [[ "\${FAIL_CREATE:-0}" != 1 ]]
}
save_config() {
  [[ "\${FAIL_SAVE:-0}" != 1 ]] || return 1
  saved=$((saved + 1))
}
created=0 saved=0 cleaned=0 restored=0
DSH_NAME=dsh-test
DSH_EDITION=standard
DSH_RESEARCH_PACK=none
DSH_IMAGE=fixture-standard
DSHD_REVERSE_MODE=0

FAIL_PULL=1
if cmd_web_switch research >/dev/null 2>&1; then
  echo "Web switch unexpectedly succeeded when image download failed" >&2; exit 1
fi
unset FAIL_PULL
[[ "$DSH_EDITION" == standard && "$DSH_IMAGE" == fixture-standard ]]
[[ "$created" == 0 && "$saved" == 0 ]]

FAIL_CREATE=1
if cmd_web_switch research >/dev/null 2>&1; then
  echo "Web switch unexpectedly succeeded when health checks failed" >&2; exit 1
fi
unset FAIL_CREATE
[[ "$DSH_EDITION" == standard && "$DSH_IMAGE" == fixture-standard ]]
[[ "$created" == 1 && "$saved" == 0 ]]

cmd_web_switch research-economics >/dev/null
[[ "$DSH_EDITION" == research && "$DSH_RESEARCH_PACK" == economics ]]
[[ "$DSH_IMAGE" == fixture-research-economics ]]
[[ "$created" == 2 && "$saved" == 1 && "$cleaned" == 1 ]]
cmd_web_switch research-economics >/dev/null
[[ "$created" == 2 && "$saved" == 1 ]]

FAIL_SAVE=1
if cmd_web_switch standard >/dev/null 2>&1; then
  echo "Web switch unexpectedly succeeded when config save failed" >&2; exit 1
fi
unset FAIL_SAVE
[[ "$restored" == 1 && "$DSH_EDITION" == research ]]
[[ "$created" == 3 && "$saved" == 1 && "$cleaned" == 1 ]]

cmd_web_switch standard >/dev/null
[[ "$DSH_EDITION" == standard && "$DSH_RESEARCH_PACK" == none ]]
[[ "$created" == 4 && "$saved" == 2 ]]
if (cmd_web_switch "evil/image" >/dev/null 2>&1); then
  echo "Accepted arbitrary edition" >&2; exit 1
fi
DSH_EDITION=reverse
if (cmd_web_switch standard >/dev/null 2>&1); then
  echo "Reverse instance could be replaced from Web" >&2; exit 1
fi
printf '[OK] Phase 2 fixed Web edition switches: rollback, failure and Reverse isolation\n'
