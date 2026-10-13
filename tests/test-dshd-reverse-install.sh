#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Reverse installer assertion failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
export DSHD_STATE_DIR="$TMP/standard"
export HOME="$TMP/home"
mkdir -p "$HOME" "$DSHD_STATE_DIR"
# shellcheck source=../dshd
source "$ROOT/dshd"
load_config
printf 'reverse-installer-test: loaded Standard defaults\n'
[[ "$DSH_EDITION" == standard ]] || { echo "Standard default changed"; exit 1; }
[[ "$DSH_IMAGE" == "$DEFAULT_IMAGE" ]] || exit 1
[[ "$REVERSE_IMAGE" == "ghcr.io/paimoncai/dsh-docker-install:reverse" ]] || exit 1

# Independent configs can persist and be recognized, without reading Standard.
(
  DSHD_STATE_DIR="$TMP/reverse"
  CONFIG_FILE="$DSHD_STATE_DIR/config.env"
  STATE_DIR="$DSHD_STATE_DIR"
  DSH_EDITION=reverse
  DSH_IMAGE="$REVERSE_IMAGE"
  DSH_NAME=dsh-reverse
  DSH_PORT=3081
  DSH_RESEARCH_PACK=none
  DSH_WORKSPACE="$TMP/reverse-workspace"
  DSH_DATA_DIR="$TMP/reverse-data"
  DSH_STORAGE_MODE=bind
  save_config
  unset DSH_EDITION DSH_IMAGE DSH_NAME DSH_PORT DSH_RESEARCH_PACK
  load_config
  [[ "$DSH_EDITION" == reverse && "$DSH_RESEARCH_PACK" == none ]] || exit 1
  [[ "$DSH_IMAGE" == "$REVERSE_IMAGE" && "$DSH_NAME" == dsh-reverse && "$DSH_PORT" == 3081 ]] || exit 1
)
[[ ! -f "$DSHD_STATE_DIR/config.env" ]] || { echo "Standard data was modified"; exit 1; }

printf 'reverse-installer-test: Reverse config roundtrip passed\n'
# Pulling a reverse image must never try the Standard edition as fallback.
DSH_EDITION=reverse
DSH_IMAGE="$REVERSE_IMAGE"
DSH_RESEARCH_PACK=none
ATTEMPTS="$TMP/pulls"
docker_cmd() {
  if [[ "$1" == pull ]]; then printf '%s\n' "$2" >>"$ATTEMPTS"; return 1; fi
  return 1
}
is_tty() { return 1; }
if pull_best_image >"$TMP/pull-out" 2>&1; then
  echo "Expected simulated pull failure"; exit 1
fi
grep -Fxq "$REVERSE_IMAGE" "$ATTEMPTS"
grep -Fxq "$REVERSE_MIRROR_IMAGE" "$ATTEMPTS"
! grep -Fxq "$DEFAULT_IMAGE" "$ATTEMPTS"
! grep -Fxq "$MIRROR_IMAGE" "$ATTEMPTS"

printf 'reverse-installer-test: no Standard fallback confirmed\n'
# The submanager must fail closed when missing or mislabeled.
if (cmd_reverse_instance status) >"$TMP/uninstalled" 2>&1; then
  echo "Missing Reverse config must fail closed"; exit 1
fi
grep -Fq "尚未安装" "$TMP/uninstalled"
mkdir -p "$DSHD_STATE_DIR-reverse"
printf 'DSH_EDITION=standard\n' >"$DSHD_STATE_DIR-reverse/config.env"
if (cmd_reverse_instance update) >"$TMP/wrong-edition" 2>&1; then
  echo "Standard-marked state must be rejected"; exit 1
fi
grep -Fq "配置标识不正确" "$TMP/wrong-edition"

printf 'reverse-installer-test: invalid Reverse state rejected\n'
# For install, intercept the child shell without executing any real Docker
# operations. Assert env separation, port and storage defaults.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/bash" <<'EOS'
#!/bin/sh
printf 'action=%s\n' "$1"
printf 'state=%s\n' "$DSHD_STATE_DIR"
printf 'edition=%s\n' "$DSH_EDITION"
printf 'image=%s\n' "$DSH_IMAGE"
printf 'name=%s\n' "$DSH_NAME"
printf 'port=%s\n' "$DSH_PORT"
printf 'workspace=%s\n' "$DSH_WORKSPACE"
printf 'data=%s\n' "$DSH_DATA_DIR"
printf 'access=%s\n' "$DSH_DOCKER_ACCESS"
EOS
chmod 755 "$TMP/bin/bash"
PATH="$TMP/bin:$PATH" cmd_reverse_instance install >"$TMP/install"
grep -Fxq "action=install" "$TMP/install"
grep -Fxq "state=$DSHD_STATE_DIR-reverse" "$TMP/install"
grep -Fxq "edition=reverse" "$TMP/install"
grep -Fxq "image=$REVERSE_IMAGE" "$TMP/install"
grep -Fxq "name=dsh-reverse" "$TMP/install"
grep -Fxq "port=3081" "$TMP/install"
grep -Fxq "access=false" "$TMP/install"
[[ ! -f "$DSHD_STATE_DIR/config.env" ]] || exit 1
printf 'reverse-installer-test: isolated install env confirmed\n'
bash -n "$ROOT/dshd"
bash -n "$ROOT/install.sh"
printf 'Reverse installation isolation tests passed\n'
