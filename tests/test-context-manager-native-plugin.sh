#!/usr/bin/env bash
# Real launcher lifecycle over one disposable volume, with no lab activation flags.
set -euo pipefail
image="${1:?Usage: bash test-context-manager-native-plugin.sh IMAGE [PRESET]}"
preset="${2:-standard}"
tag="cm-native-plugin-${GITHUB_RUN_ID:-local}-$$"
name="${tag}-web"
volume="${tag}-data"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
save(){
  docker run --rm -v "$volume:/root/.dsh" "$image" node --input-type=module -e '
    import {readSettings,writeSettings,settingsRevision} from "/opt/dsh/plugins/dsh-context-manager/storage.mjs"
    const saved=readSettings();const revision=settingsRevision(saved)
    saved.nativePlugin.enabled=process.argv[1]==="enabled"
    saved.engine=saved.nativePlugin.enabled?"tiered":"basic"
    writeSettings(saved,revision)
  ' "$1" >/dev/null
}
wait_ready(){
  local state="$1" marker="$2" logs
  for _ in {1..95}; do
    logs="$(docker logs "$name" 2>&1 || true)"
    if grep -q "DSH_CONTEXT_MANAGER_NATIVE_PLUGIN_READY $state" <<<"$logs" \
      && grep -q "$marker" <<<"$logs"; then return 0; fi
    if grep -Eq 'DSH_CONTEXT_MANAGER_(CI_FAILED|CI_REPLAY_FAILED)' <<<"$logs" \
      || [[ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]]; then break; fi
    sleep 1
  done
  docker logs "$name" 2>&1 | tail -100
  echo "::error::Native context plugin lifecycle did not reach $state for $preset"
  return 1
}
start_enabled(){
  docker run -d --name "$name" -v "$volume:/root/.dsh" \
    -e DSH_CONTEXT_MANAGER_CI_EXPECT_PRESETS="$preset" \
    -e DSH_CONTEXT_MANAGER_CI_REQUIRE_MOUNTED=1 \
    -e DSH_CONTEXT_MANAGER_CI_NATIVE_STATE=enabled \
    -e DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=seed \
    -e DSH_CONTEXT_MANAGER_CI_REPLAY_PRESET="$preset" \
    -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR=1 \
    -e DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume \
    "$image" >/dev/null
}
save enabled
start_enabled
wait_ready enabled 'DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED '
logs="$(docker logs "$name" 2>&1)"
grep -q 'DSH_CONTEXT_EVENT .*"event":"plugin.boot".*"enabled":true' <<<"$logs"
grep -q 'DSH_CONTEXT_EVENT .*"event":"engine.mounted"' <<<"$logs"
sid="$(sed -n 's/.*DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED //p' <<<"$logs" | tail -1)"
ref="$(sed -n 's/.*DSH_CONTEXT_MANAGER_CI_REPLAY_CCR_SEEDED //p' <<<"$logs" | tail -1)"
[[ "$sid" =~ ^[A-Za-z0-9_.:-]{1,128}$ && "$ref" =~ ^dshccr:v2:[a-f0-9]{16}:[0-9]+$ ]]
docker rm -f "$name" >/dev/null
save disabled
docker run -d --name "$name" -v "$volume:/root/.dsh" \
  -e DSH_CONTEXT_MANAGER_TIERED_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_ACP_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_CCR_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_CI_EXPECT_PRESETS="$preset" \
  -e DSH_CONTEXT_MANAGER_CI_NATIVE_STATE=disabled \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=verify \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_SESSION="$sid" \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR=1 \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR_REF="$ref" \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume \
  "$image" >/dev/null
wait_ready disabled "DSH_CONTEXT_MANAGER_CI_REPLAY_VERIFIED $sid cold=true"
logs="$(docker logs "$name" 2>&1)"
grep -q 'CCR_ROLLBACK_VERIFIED originalExact=true' <<<"$logs"
grep -q 'DSH_CONTEXT_EVENT .*"event":"plugin.boot".*"enabled":false' <<<"$logs"
docker rm -f "$name" >/dev/null
save enabled
start_enabled
wait_ready enabled 'DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED '
echo "DSH_CONTEXT_MANAGER_NATIVE_PLUGIN_LIFECYCLE_PASS preset=$preset enable=true disable=true reenable=true coldOriginal=true labActivationFlags=false"
