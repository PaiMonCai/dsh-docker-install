#!/usr/bin/env bash
# Named-instance routing, defaults and container ownership without Docker.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
export DSHD_STATE_DIR="$TMP/state" HOME="$TMP/home"
mkdir -p "$DSHD_STATE_DIR" "$HOME"

# shellcheck source=../dshd
source "$ROOT/dshd"
load_config
DSH_NAME=dsh
DSH_PORT=3082
save_config
grep -Fxq 'DSHD_INSTANCE_ID=' "$CONFIG_FILE"
grep -Fxq 'DSH_PORT=3082' "$CONFIG_FILE"

instance_validate_id my-research
! instance_validate_id ../escape
! instance_validate_id default
! instance_validate_id BadName

EXPECTED_BASE="$HOME/dsh/instances/study"
if [[ $(id -u) -eq 0 ]]; then EXPECTED_BASE="/opt/dsh/instances/study"; fi
env DSHD_INSTANCE_ID=study DSHD_LIB_ONLY=1 DSHD_STATE_DIR="$TMP/study" \
  HOME="$HOME" ROOT="$ROOT" /usr/bin/bash -c '
  source "$ROOT/dshd"
  load_config
  [[ "$DSH_DATA_DIR" == "'"$EXPECTED_BASE"'/data" ]]
  [[ "$DSH_WORKSPACE" == "'"$EXPECTED_BASE"'/workspace" ]]
' || { echo "per-instance storage defaults are not isolated" >&2; exit 1; }

port_in_use() { return 1; }
[[ "$(instance_next_port)" == 3083 ]]

ensure_docker() { :; }
docker_cmd() { return 1; }
mkdir -p "$TMP/bin"
cat > "$TMP/bin/bash" <<'STUB'
#!/bin/sh
printf 'action=%s\n' "$2"
printf 'state=%s\n' "$DSHD_STATE_DIR"
printf 'id=%s\n' "$DSHD_INSTANCE_ID"
printf 'edition=%s\n' "${DSH_EDITION:-}"
printf 'pack=%s\n' "${DSH_RESEARCH_PACK:-}"
printf 'name=%s\n' "${DSH_NAME:-}"
printf 'port=%s\n' "${DSH_PORT:-}"
printf 'image=%s\n' "${DSH_IMAGE:-}"
STUB
chmod +x "$TMP/bin/bash"
PATH="$TMP/bin:$PATH" instance_add study research-economics > "$TMP/install.out"
grep -Fxq "action=install" "$TMP/install.out"
grep -Fxq "state=$DSHD_STATE_DIR/instances/study" "$TMP/install.out"
grep -Fxq "id=study" "$TMP/install.out"
grep -Fxq "name=dsh-study" "$TMP/install.out"
grep -Fxq "port=3083" "$TMP/install.out"
grep -Fxq "edition=research" "$TMP/install.out"
grep -Fxq "pack=economics" "$TMP/install.out"
grep -Fxq "image=$RESEARCH_ECONOMICS_IMAGE" "$TMP/install.out"
[[ ! -e "$DSHD_STATE_DIR/instances/study" ]] || {
  echo "stub must not modify registry" >&2; exit 1;
}

mkdir -p "$DSHD_STATE_DIR/instances/study"
cat > "$DSHD_STATE_DIR/instances/study/config.env" <<'CONF'
DSHD_INSTANCE_ID=study
DSH_NAME=dsh-study
DSH_PORT=3083
DSH_EDITION=research
CONF
PATH="$TMP/bin:$PATH" main -i study status > "$TMP/status.out"
grep -Fxq 'action=status' "$TMP/status.out"
grep -Fxq 'id=study' "$TMP/status.out"
PATH="$TMP/bin:$PATH" cmd_instance study update > "$TMP/update.out"
grep -Fxq 'action=update' "$TMP/update.out"
cmd_instances > "$TMP/list.out"
grep -Fq 'default' "$TMP/list.out"
grep -Fq 'study' "$TMP/list.out"

if ( PATH="$TMP/bin:$PATH" instance_exec nonexistent update ) > "$TMP/rejected" 2>&1; then
  echo "missing named instance unexpectedly accepted" >&2; exit 1
fi
sed -i 's/DSHD_INSTANCE_ID=study/DSHD_INSTANCE_ID=wrong/' \
  "$DSHD_STATE_DIR/instances/study/config.env"
if ( PATH="$TMP/bin:$PATH" instance_exec study update ) > "$TMP/rejected" 2>&1; then
  echo "mismatched instance identity unexpectedly accepted" >&2; exit 1
fi

docker_cmd() {
  case "$1" in
    ps) printf '%s\n' dsh-study ;;
    inspect) printf '%s\n' 'study' ;;
    *) return 1 ;;
  esac
}
DSH_NAME=dsh-study
DSHD_INSTANCE_ID=study
container_exists
DSHD_INSTANCE_ID=other
if ( container_exists ) > "$TMP/rejected" 2>&1; then
  echo "cross-instance container takeover was allowed" >&2; exit 1
fi
DSHD_INSTANCE_ID=
if ( container_exists ) > "$TMP/rejected" 2>&1; then
  echo "legacy default manager adopted named container" >&2; exit 1
fi

bash -n "$ROOT/dshd"
printf 'dshd multi-instance tests passed\n'
