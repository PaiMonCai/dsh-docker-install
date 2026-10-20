#!/usr/bin/env bash
# Real, disposable Docker export -> archive verify -> import -> boot smoke.
# Never run on a machine with real user DSH state. Only CI audit image dsh-ci:pr.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
docker image inspect dsh-ci:pr >/dev/null
tmp="$(mktemp -d)"
id="portablesmoke$RANDOM"
export DSHD_STATE_DIR="$tmp/state" DSHD_NO_SELF_UPDATE=1
root="/opt/dsh/instances/$id"
container="dsh-$id"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$root" "$tmp"
}
trap cleanup EXIT
[[ ! -e "$root" ]] || { echo "CI import directory already exists" >&2; exit 1; }
[[ ! -d "$DSHD_STATE_DIR/instances/$id" ]] || exit 1

mkdir -p "$tmp/data" "$tmp/workspace" "$tmp/custom" "$DSHD_STATE_DIR"
printf 'session-example\n' > "$tmp/data/portable-session.txt"
printf 'workspace-example\n' > "$tmp/workspace/portable-project.txt"
printf 'mount-example\n' > "$tmp/custom/tool.conf"
cat > "$DSHD_STATE_DIR/mounts.conf" <<EOF
$tmp/custom|/root/.config/portable-test|ro
EOF
DSHD_LIB_ONLY=1 bash -c '
  source ./dshd
  load_config
  DSH_IMAGE=dsh-ci:pr
  DSH_NAME=dsh-portable-source
  DSH_WORKSPACE="'"$tmp"'/workspace"
  DSH_DATA_DIR="'"$tmp"'/data"
  DSH_STORAGE_MODE=bind
  DSH_DOCKER_ACCESS=false
  DSH_PROXY_ENABLED=false
  DSH_SEARCH_ENABLED=false
  DSH_PORT=3094
  save_config
'

archive="$tmp/portable.dshbak"
bash ./dshd backup export "$archive"
bash ./dshd backup verify "$archive"
bash ./dshd backup import "$archive" "$id"
test -f "$root/data/portable-session.txt"
test -f "$root/workspace/portable-project.txt"
test "$(cat "$root/data/portable-session.txt")" = "session-example"
grep -Fxq "DSHD_INSTANCE_ID=$id" "$DSHD_STATE_DIR/instances/$id/config.env"
grep -q '^DSH_DOCKER_ACCESS=false' "$DSHD_STATE_DIR/instances/$id/config.env"
grep -Fq '|/root/.config/portable-test|ro' "$DSHD_STATE_DIR/instances/$id/mounts.conf"
mount_src="$(cut -d'|' -f1 "$DSHD_STATE_DIR/instances/$id/mounts.conf")"
test "$(cat "$mount_src/tool.conf")" = "mount-example"
docker inspect "$container" >/dev/null
[[ ! -e "$DSHD_STATE_DIR/instances/$id/backups" ]]
# Reject a second import to the same ID; existing restored state stays intact.
if bash ./dshd backup import "$archive" "$id" >/dev/null 2>&1; then
  echo "Existing instance was overwritten by import" >&2
  exit 1
fi
test "$(cat "$root/data/portable-session.txt")" = "session-example"
printf 'Real Docker complete export/import smoke PASS\n'
