#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${1:-39080}"
TIMEOUT_SECONDS="${DSH_RESEARCH_SMOKE_TIMEOUT_SECONDS:-120}"
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "DSH_RESEARCH_SMOKE_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 1
fi
TMP_HOME="$(mktemp -d)"
LOG="$(mktemp)"
PID=""

cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" >/dev/null 2>&1; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_HOME"
  rm -f "$LOG"
}
trap cleanup EXIT

ARGS=(web)
if [[ -f /opt/dsh/dsh-bind.patch.yml ]]; then
  ARGS+=(--patch /opt/dsh/dsh-bind.patch.yml)
fi
ARGS+=(--port "$PORT" --no-open)

# A build-time smoke runs DSH directly, without the Docker entrypoint. Keep it
# on loopback instead of relying on the old wildcard patch default.
DSH_HOME="$TMP_HOME" DSH_BIND_HOST=127.0.0.1 dsh "${ARGS[@]}" >"$LOG" 2>&1 &
PID="$!"

ready=0
code=000
deadline=$((SECONDS + TIMEOUT_SECONDS))
# Emulated ARM64 cold starts can outlast a fixed number of half-second polls.
while (( SECONDS < deadline )); do
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    echo "DSH web exited before Adapter smoke became ready" >&2
    cat "$LOG" >&2
    exit 1
  fi

  code="$(curl -sS --connect-timeout 1 --max-time 2 \
    -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  case "$code" in
    200|302|303|401)
      ready=1
      break
      ;;
  esac
  sleep 0.5
done

if [[ "$ready" != "1" ]]; then
  echo "DSH web did not become ready during Adapter runtime smoke after ${TIMEOUT_SECONDS}s (last HTTP $code)" >&2
  cat "$LOG" >&2
  exit 1
fi

printf '[✓] DSH-native Research Adapter runtime boot passed (HTTP %s)\n' "$code"
