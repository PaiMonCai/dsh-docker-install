#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${1:-39080}"
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

DSH_HOME="$TMP_HOME" dsh web --port "$PORT" --no-open >"$LOG" 2>&1 &
PID="$!"

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    echo "DSH web exited before Adapter smoke became ready" >&2
    cat "$LOG" >&2
    exit 1
  fi

  code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  case "$code" in
    200|302|303|401)
      ready=1
      break
      ;;
  esac
  sleep 0.5
done

if [[ "$ready" != "1" ]]; then
  echo "DSH web did not become ready during Adapter runtime smoke" >&2
  cat "$LOG" >&2
  exit 1
fi

printf '[✓] DSH-native Research Adapter runtime boot passed (HTTP %s)\n' "$code"
