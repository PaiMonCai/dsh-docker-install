#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WRAPPER="$ROOT/research/adapter/dsh-wrapper"
PATCH="$ROOT/research/adapter/cordis.patch.yml"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/real-dsh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@"
EOF
chmod +x "$TMP/real-dsh"
touch "$TMP/user.patch.yml"

run_wrapper() {
  DSH_REAL_DSH="$TMP/real-dsh" \
  DSH_RESEARCH_ADAPTER_PATCH="$PATCH" \
  bash "$WRAPPER" "$@"
}

run_wrapper_profiles() {
  local profiles="$1"
  shift
  DSH_RESEARCH_ADAPTER_PROFILES="$profiles" \
  DSH_REAL_DSH="$TMP/real-dsh" \
  DSH_RESEARCH_ADAPTER_PATCH="$PATCH" \
  bash "$WRAPPER" "$@"
}

assert_lines() {
  local label="$1"
  local actual_name="$2"
  shift 2
  local -n actual="$actual_name"
  local expected=("$@")
  [[ "${#actual[@]}" -eq "${#expected[@]}" ]] || {
    printf '[x] %s length mismatch: got %s expected %s\n' "$label" "${#actual[@]}" "${#expected[@]}" >&2
    printf 'got: %q\n' "${actual[*]}" >&2
    exit 1
  }
  local i
  for i in "${!expected[@]}"; do
    [[ "${actual[i]}" == "${expected[i]}" ]] || {
      printf '[x] %s arg %s: got %q expected %q\n' "$label" "$i" "${actual[i]}" "${expected[i]}" >&2
      exit 1
    }
  done
}

mapfile -t web < <(run_wrapper web --port 9000)
assert_lines web web web --patch "$PATCH" --port 9000

mapfile -t headless < <(run_wrapper headless "inspect this project")
assert_lines headless headless headless --patch "$PATCH" "inspect this project"

# Unknown/custom profiles preserve upstream behavior by default.
mapfile -t tui_default < <(run_wrapper tui --resume abc)
assert_lines tui-default tui_default tui --resume abc

# Operators can extend the compatibility set without changing the wrapper.
mapfile -t tui < <(run_wrapper_profiles "web,headless,tui" tui --resume abc)
assert_lines tui tui tui --patch "$PATCH" --resume abc

mapfile -t explicit < <(run_wrapper_profiles "tui" --profile tui --resume abc)
assert_lines explicit explicit --profile tui --patch "$PATCH" --resume abc

mapfile -t equals < <(run_wrapper_profiles "tui" --profile=tui --resume abc)
assert_lines profile-equals equals --profile=tui --patch "$PATCH" --resume abc

mapfile -t wildcard < <(run_wrapper_profiles "*" custom --resume abc)
assert_lines wildcard wildcard custom --patch "$PATCH" --resume abc

# Existing user overlays keep their order; Adapter becomes the final launcher patch.
mapfile -t user_patch < <(
  run_wrapper_profiles "tui" tui --patch "$TMP/user.patch.yml" --resume abc
)
assert_lines user-patch user_patch \
  tui --patch "$TMP/user.patch.yml" --patch "$PATCH" --resume abc

# Do not inject the same adapter twice.
mapfile -t duplicate < <(
  run_wrapper_profiles "tui" tui --patch "$PATCH" --resume abc
)
assert_lines duplicate duplicate tui --patch "$PATCH" --resume abc

# Explicit profile and launcher flags may be ordered before the app boundary.
mapfile -t launcher < <(
  run_wrapper --patch "$TMP/user.patch.yml" --profile web --dump-config
)
assert_lines launcher launcher \
  --patch "$TMP/user.patch.yml" --profile web --dump-config --patch "$PATCH"

# Upstream explicitly rejects patches with --dump-default-config, so the wrapper
# must preserve that invocation rather than making it invalid itself.
mapfile -t dump_default < <(run_wrapper --profile web --dump-default-config)
assert_lines dump-default dump_default --profile web --dump-default-config

mapfile -t plugin < <(run_wrapper plugin --profile web why dsh-research-adapter)
assert_lines plugin plugin plugin --profile web why dsh-research-adapter

mapfile -t disabled < <(
  DSH_RESEARCH_ADAPTER_DISABLE=1 \
  DSH_REAL_DSH="$TMP/real-dsh" \
  DSH_RESEARCH_ADAPTER_PATCH="$PATCH" \
  bash "$WRAPPER" web
)
assert_lines disabled disabled web

printf '[✓] Research dsh wrapper compatibility tests passed\n'
