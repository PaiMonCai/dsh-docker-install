#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1 DSHD_STATE_DIR="$tmp/state"
export DSHD_CONFIG_FILE="$tmp/state/config.env"
mkdir -p "$DSHD_STATE_DIR"
source ./dshd

load_config() { DSH_NAME=dsh-test; }
ensure_docker() { return 0; }
container_running() { return 0; }
docker_cmd() {
  printf '%s\n' "$*" >>"$tmp/docker.log"
  if [[ "$*" == "exec dsh-test test -f /usr/local/bin/dsh-plugin-doctor.js" ]]; then return 0; fi
  if [[ "$*" == "exec dsh-test node /usr/local/bin/dsh-plugin-doctor.js --json" ]]; then
    printf '{"healthy":true,"checks":[]}\n'
    return 0
  fi
  return 1
}
out="$(cmd_doctor_plugins --json)"
[[ "$out" == '{"healthy":true,"checks":[]}' ]]
grep -Fq 'exec dsh-test node /usr/local/bin/dsh-plugin-doctor.js --json' "$tmp/docker.log"

container_running() { return 1; }
if cmd_doctor_plugins --json >"$tmp/out" 2>"$tmp/err"; then
  echo "doctor plugins should fail for a stopped container" >&2; exit 1
fi

container_running() { return 0; }
docker_cmd() { return 1; }
if cmd_doctor_plugins --json >"$tmp/out" 2>"$tmp/err"; then
  echo "doctor plugins should reject an image without the diagnostic script" >&2; exit 1
fi
grep -Fq '未包含插件诊断器' "$tmp/err"

# Parent doctor behavior must stay unchanged.
grep -Fq 'doctor|check)' dshd
grep -Fq 'cmd_doctor' dshd
grep -Fq 'dshd doctor plugins' dshd
echo 'dshd doctor plugins routing checks passed'
