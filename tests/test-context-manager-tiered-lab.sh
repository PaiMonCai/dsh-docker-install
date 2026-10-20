#!/usr/bin/env bash
# Actual DSH Web profile/AgentPreset Cordis loader proof on a disposable
# named Docker volume, with no LLM requests or real user sessions.
set -euo pipefail
image="${1:?Usage: bash test-context-manager-tiered-lab.sh IMAGE}"
tag="cm-tiered-lab-${GITHUB_RUN_ID:-local}-$$"
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
  "$image" >/dev/null
found=0
for _ in {1..85}; do
  logs="$(docker logs "$name" 2>&1 || true)"
  if grep -q 'DSH_CONTEXT_MANAGER_TIERED_LAB_READY standard:single-provider' <<<"$logs"; then found=1;break;fi
  if grep -Eq 'DSH_CONTEXT_MANAGER_TIERED_(LAB_FAILED|PREFLIGHT_DENIED)' <<<"$logs"; then
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
echo "DSH_CONTEXT_MANAGER_TIERED_LAB_TEST_PASS: preset standard single tiered backend with /compact command"
