#!/usr/bin/env bash
# Actual native ACP tool plugin + Tiered compactor mounted ownership proof on a disposable
# named Docker volume, with no LLM requests or real user sessions.
set -euo pipefail
image="${1:?Usage: bash test-context-manager-tiered-lab.sh IMAGE}"
tag="cm-acp-lab-${GITHUB_RUN_ID:-local}-$$"
name="${tag}-web"
volume="${tag}-data"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run --rm -v "$volume:/root/.dsh" "$image" node --input-type=module -e '
 import {defaults} from "/opt/dsh/plugins/dsh-context-manager/policy.mjs"
 import {readSettings,writeSettings,settingsRevision} from "/opt/dsh/plugins/dsh-context-manager/storage.mjs"
 const config=defaults();config.engine="tiered"
 writeSettings(config,settingsRevision(readSettings()))
' >/dev/null
docker run -d --name "$name" -v "$volume:/root/.dsh" \
  -e DSH_CONTEXT_MANAGER_PROBE=true \
  -e DSH_CONTEXT_MANAGER_TIERED_ACTIVE=1 \
  -e DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=1 \
  -e DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY=1 \
  -e DSH_CONTEXT_MANAGER_ACP_ACTIVE=1 \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=seed \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR=1 \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume \
  "$image" >/dev/null
found=0
for _ in {1..85}; do
  logs="$(docker logs "$name" 2>&1 || true)"
  if grep -q 'DSH_CONTEXT_MANAGER_TIERED_LAB_READY standard:single-provider' <<<"$logs" \
    && grep -q 'DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED ' <<<"$logs" \
    && grep -q 'DSH_CONTEXT_MANAGER_CI_REPLAY_CCR_SEEDED ' <<<"$logs"; then found=1;break;fi
  if grep -Eq 'DSH_CONTEXT_MANAGER_TIERED_(LAB_FAILED|PREFLIGHT_DENIED)|DSH_CONTEXT_MANAGER_CI_REPLAY_FAILED' <<<"$logs"; then
    echo "$logs" | tail -80
    echo "::error::Tiered lab preflight or unique-provider check failed"
    exit 1
  fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$name")" == true ]] || {
    echo "$logs" | tail -80
    echo "::error::Lab DSH container exited before single-owner proof"
    exit 1
  }
  sleep 1
done
if [[ "$found" != 1 ]];then
  docker logs "$name" 2>&1|tail -90
  echo "::error::Timed out checking native preset tiered replacement"
  exit 1
fi
echo "DSH_CONTEXT_MANAGER_ACP_LAB_TEST_PASS: native Standard preset active Tiered owner and ACP tools plugin"

sid="$(sed -n 's/.*DSH_CONTEXT_MANAGER_CI_REPLAY_SEEDED //p' <<<"$logs" | tail -1)"
ref="$(sed -n 's/.*DSH_CONTEXT_MANAGER_CI_REPLAY_CCR_SEEDED //p' <<<"$logs" | tail -1)"
[[ "$sid" =~ ^[A-Za-z0-9_.:-]{1,128}$ && "$ref" =~ ^dshccr:v2:[a-f0-9]{16}:[0-9]+$ ]]
docker rm -f "$name" >/dev/null
docker run --rm -v "$volume:/root/.dsh" "$image" node --input-type=module -e '
 import {readSettings,writeSettings,settingsRevision} from "/opt/dsh/plugins/dsh-context-manager/storage.mjs"
 const config=readSettings();config.engine="basic"
 writeSettings(config,settingsRevision(readSettings()))
' >/dev/null
docker run -d --name "$name" -v "$volume:/root/.dsh" \
  -e DSH_CONTEXT_MANAGER_TIERED_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_ACP_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_CCR_ACTIVE=0 \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=verify \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_SESSION="$sid" \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR=1 \
  -e DSH_CONTEXT_MANAGER_CI_REPLAY_CCR_REF="$ref" \
  "$image" >/dev/null
for _ in {1..85}; do
  logs="$(docker logs "$name" 2>&1 || true)"
  if grep -q "DSH_CONTEXT_MANAGER_CI_REPLAY_VERIFIED $sid cold=true" <<<"$logs" \
    && grep -q 'CCR_ROLLBACK_VERIFIED originalExact=true flagsOff=true' <<<"$logs"; then
    echo 'DSH_CONTEXT_MANAGER_FLAGS_OFF_ROLLBACK_PASS cold=true originalExact=true'
    exit 0
  fi
  if grep -q 'DSH_CONTEXT_MANAGER_CI_REPLAY_FAILED' <<<"$logs" \
    || [[ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]]; then break; fi
  sleep 1
done
echo "$logs" | tail -90
echo '::error::Flags-off rollback failed to recover the cold Session and exact CCR original'
exit 1
