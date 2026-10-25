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
printf 'action=%s\n' "$2"
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

# The ordinary first-install menu must reach the same isolated child before
# the primary wizard, config persistence, image pull or container creation.
(
  DSH_EDITION=standard; DSH_IMAGE="$DEFAULT_IMAGE"
  DSH_NAME=primary-test; DSH_PORT=3099
  unset DSHD_REVERSE_MODE DSHD_INSTANCE_ID DSHD_INSTANCE_EDITION
  is_tty() { return 0; }
  detect_os() { OS_PRETTY=test; }
  ensure_docker() { :; }
  network_report() { :; }
  interactive_config() { echo primary-wizard; return 1; }
  save_config() { echo primary-save; return 1; }
  pull_best_image() { echo primary-pull; return 1; }
  create_container() { echo primary-container; return 1; }
  PATH="$TMP/bin:$PATH" cmd_install <<< $'invalid\n3' >"$TMP/first-reverse"
  grep -Fq '3) Reverse' "$TMP/first-reverse"
  grep -Fxq 'action=install' "$TMP/first-reverse"
  grep -Fxq "state=$DSHD_STATE_DIR-reverse" "$TMP/first-reverse"
  grep -Fxq 'name=dsh-reverse' "$TMP/first-reverse"
  grep -Fxq 'port=3081' "$TMP/first-reverse"
  grep -Fxq 'access=false' "$TMP/first-reverse"
  ! grep -Eq '^primary-(wizard|save|pull|container)$' "$TMP/first-reverse"
  [[ ! -f "$CONFIG_FILE" ]]

  cmd_reverse_instance() { return 7; }
  rc=0
  cmd_install <<< 3 >"$TMP/reverse-failed" || rc=$?
  [[ "$rc" == 7 ]] || { echo 'Reverse child failure was hidden'; exit 1; }
  ! grep -Eq '^primary-(wizard|save|pull|container)$' "$TMP/reverse-failed"

  if cmd_install </dev/null >"$TMP/edition-eof" 2>&1; then
    echo 'First-install EOF must cancel'; exit 1
  fi
  ! grep -Eq '^primary-(wizard|save|pull|container)$' "$TMP/edition-eof"

  # Existing defaults and named/noninteractive installs must keep their route.
  interactive_config() { printf 'wizard=%s:%s\n' "$1" "${2:-}"; return 1; }
  for selection in '' 1 2; do
    rc=0
    cmd_install <<< "$selection" >"$TMP/edition-selection" || rc=$?
    [[ "$rc" == 1 ]]
    grep -Fxq "wizard=initial:${selection:-1}" "$TMP/edition-selection"
  done
  is_tty() { return 1; }
  cmd_install </dev/null >"$TMP/no-tty" || true
  grep -Fxq 'wizard=initial:' "$TMP/no-tty"
  ! grep -Fq '3) Reverse' "$TMP/no-tty"
  is_tty() { return 0; }
  DSHD_INSTANCE_EDITION=research
  cmd_install </dev/null >"$TMP/named" || true
  grep -Fxq 'wizard=initial:' "$TMP/named"
  ! grep -Fq '3) Reverse' "$TMP/named"
)

(
  # Drive the real Research Pack branch, then cancel at the container prompt.
  unset DSHD_REVERSE_MODE
  is_tty() { return 0; }
  prompt_required() { return 1; }
  for pack in 1 2; do
    if interactive_config initial 2 <<< "$pack" >"$TMP/research-choice"; then
      echo 'Container prompt cancellation must propagate'; exit 1
    fi
    [[ "$DSH_EDITION" == research ]]
    if [[ "$pack" == 1 ]]; then
      [[ "$DSH_RESEARCH_PACK" == none && "$DSH_IMAGE" == "$RESEARCH_IMAGE" ]]
    else
      [[ "$DSH_RESEARCH_PACK" == economics && "$DSH_IMAGE" == "$RESEARCH_ECONOMICS_IMAGE" ]]
    fi
  done
)
printf 'reverse-installer-test: first-install selection and cancellation passed\n'
bash -n "$ROOT/dshd"
bash -n "$ROOT/install.sh"
printf 'Reverse installation isolation tests passed\n'
