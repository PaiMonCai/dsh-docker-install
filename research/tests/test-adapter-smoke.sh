#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SMOKE="$ROOT/research/adapter/smoke-web.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
export SMOKE_TEST_REAL_SLEEP
SMOKE_TEST_REAL_SLEEP="$(command -v sleep)"

cat >"$TMP/bin/dsh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$$" >"$SMOKE_TEST_STATE/pid"
printf '%s\n' "$DSH_HOME" >"$SMOKE_TEST_STATE/home"
echo 'mock DSH startup'
if [[ "${SMOKE_TEST_MODE:-}" == exit ]]; then
  echo 'mock DSH startup failure' >&2
  exit 17
fi
exec "$SMOKE_TEST_REAL_SLEEP" 60
EOF

cat >"$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
# A non-responsive endpoint must not leave the readiness probe unbounded.
[[ " $* " == *" --connect-timeout 1 "* ]] || exit 90
[[ " $* " == *" --max-time 2 "* ]] || exit 91
count=0
if [[ -f "$SMOKE_TEST_STATE/probes" ]]; then
  read -r count <"$SMOKE_TEST_STATE/probes"
fi
count=$((count + 1))
printf '%s\n' "$count" >"$SMOKE_TEST_STATE/probes"
if [[ "${SMOKE_TEST_MODE:-}" == delayed && "$count" -gt 45 ]]; then
  printf 401
else
  printf 503
fi
EOF

cat >"$TMP/bin/sleep" <<'EOF'
#!/usr/bin/env bash
# Accelerate polling so the delayed-start regression need not wait 20 seconds.
exit 0
EOF
chmod +x "$TMP/bin/"*

run_smoke() {
  local mode="$1" timeout="$2"
  export SMOKE_TEST_STATE="$TMP/$mode"
  mkdir -p "$SMOKE_TEST_STATE"
  SMOKE_TEST_MODE="$mode" DSH_RESEARCH_SMOKE_TIMEOUT_SECONDS="$timeout" \
    PATH="$TMP/bin:$PATH" bash "$SMOKE" >"$SMOKE_TEST_STATE/output" 2>&1
}

assert_cleaned_up() {
  local pid home
  if [[ -f "$SMOKE_TEST_STATE/pid" ]]; then
    read -r pid <"$SMOKE_TEST_STATE/pid"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "Smoke left its DSH process running: $pid" >&2
      exit 1
    fi
    read -r home <"$SMOKE_TEST_STATE/home"
    [[ ! -d "$home" ]]
  fi
}

# More than the former 40 probes must be allowed while time remains.
run_smoke delayed 120
grep -q 'runtime boot passed (HTTP 401)' "$SMOKE_TEST_STATE/output"
[[ "$(cat "$SMOKE_TEST_STATE/probes")" -eq 46 ]]
assert_cleaned_up
echo 'Delayed Web startup passed'

if run_smoke timeout 1; then
  echo 'An unready Web endpoint must fail at the deadline' >&2
  exit 1
fi
grep -q 'after 1s (last HTTP 503)' "$SMOKE_TEST_STATE/output"
grep -q 'mock DSH startup' "$SMOKE_TEST_STATE/output"
assert_cleaned_up
echo 'Web startup deadline and diagnostics passed'

if run_smoke exit 120; then
  echo 'A failed DSH process must fail the smoke' >&2
  exit 1
fi
grep -q 'DSH web exited before Adapter smoke became ready' "$SMOKE_TEST_STATE/output"
grep -q 'mock DSH startup failure' "$SMOKE_TEST_STATE/output"
assert_cleaned_up
echo 'Early process exit diagnostics passed'

for timeout in 0 -1 invalid; do
  if run_smoke "invalid-$timeout" "$timeout"; then
    echo "Invalid timeout was accepted: $timeout" >&2
    exit 1
  fi
  grep -q 'must be a positive integer' "$SMOKE_TEST_STATE/output"
  [[ ! -f "$SMOKE_TEST_STATE/pid" ]]
done
echo 'Invalid Web startup deadlines rejected'
