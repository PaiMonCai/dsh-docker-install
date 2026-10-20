#!/usr/bin/env bash
# Run only in GitHub Actions on disposable images. Uses two *different*
# containers with the same dedicated DSH_HOME Docker volume.
set -euo pipefail
image="${1:?usage: test-context-manager-native-replay.sh IMAGE [PRESET]}"
preset="${2:-standard}"
unique="dsh-cm-replay-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
volume="${unique}-data"
name="${unique}-web"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
start() {
  local mode="$1" sid="${2:-}"
  args=(-e DSH_CONTEXT_MANAGER_PROBE=true
        -e DSH_CONTEXT_MANAGER_CI_REPLAY_MODE="$mode"
        -e DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume
        -e DSH_CONTEXT_MANAGER_CI_REPLAY_PRESET="$preset")
  if [[ -n "$sid" ]]; then
    args+=(-e DSH_CONTEXT_MANAGER_CI_REPLAY_SESSION="$sid")
  fi
  docker run -d --name "$name" -v "$volume:/root/.dsh" "${args[@]}" "$image" >/dev/null
}
expect_marker() {
  local success="$1"
  for _ in {1..100}; do
    if [[ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]]; then
      docker logs "$name" | tail -120
      echo "::error::Replay test container exited"
      exit 1
    fi
    if docker logs "$name" 2>&1 | grep -Fq 'DSH_CONTEXT_MANAGER_CI_REPLAY_FAILED'; then
      docker logs "$name" | tail -120
      echo "::error::Native DSH Session replay failure"
      exit 1
    fi
    found="$(docker logs "$name" 2>&1 | grep -F "$success" | tail -1 || true)"
    if [[ -n "$found" ]]; then
      echo "$found"
      return
    fi
    sleep 1
  done
  docker logs "$name" | tail -120
  echo "::error::Timed out waiting for $success"
  exit 1
}
start seed
result="$(expect_marker 'DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED ')"
sid="${result##*DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED }"
[[ "$sid" =~ ^[A-Za-z0-9_.:-]{1,128}$ ]] || { echo "::error::Invalid native Session ID"; exit 1; }
docker rm -f "$name" >/dev/null
start verify "$sid"
expect_marker "DSH_CONTEXT_MANAGER_CI_REPLAY_VERIFIED $sid cold=true"
echo "Native DSH Session, compaction evidence, and original text survived Docker recreate"
