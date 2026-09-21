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

run_wrapper() {
  DSH_REAL_DSH="$TMP/real-dsh"   DSH_RESEARCH_ADAPTER_PATCH="$PATCH"   bash "$WRAPPER" "$@"
}

mapfile -t web < <(run_wrapper web --port 9000)
[[ "${web[0]}" == "web" ]]
[[ "${web[1]}" == "--patch" ]]
[[ "${web[2]}" == "$PATCH" ]]
[[ "${web[3]}" == "--port" ]]
[[ "${web[4]}" == "9000" ]]

mapfile -t headless < <(run_wrapper headless "inspect this project")
[[ "${headless[0]}" == "headless" ]]
[[ "${headless[1]}" == "--patch" ]]
[[ "${headless[2]}" == "$PATCH" ]]
[[ "${headless[3]}" == "inspect this project" ]]

mapfile -t profile < <(run_wrapper --profile web --dump-config)
[[ "${profile[0]}" == "--profile" ]]
[[ "${profile[1]}" == "web" ]]
[[ "${profile[2]}" == "--patch" ]]
[[ "${profile[3]}" == "$PATCH" ]]
[[ "${profile[4]}" == "--dump-config" ]]

mapfile -t plugin < <(run_wrapper plugin --profile web why dsh-research-adapter)
[[ "${plugin[0]}" == "plugin" ]]
[[ "${plugin[1]}" == "--profile" ]]
[[ "${plugin[2]}" == "web" ]]
[[ "${plugin[3]}" == "why" ]]
[[ "${plugin[4]}" == "dsh-research-adapter" ]]

mapfile -t disabled < <(
  DSH_RESEARCH_ADAPTER_DISABLE=1   DSH_REAL_DSH="$TMP/real-dsh"   DSH_RESEARCH_ADAPTER_PATCH="$PATCH"   bash "$WRAPPER" web
)
[[ "${disabled[0]}" == "web" ]]
[[ "${#disabled[@]}" -eq 1 ]]

printf '[✓] Research dsh wrapper tests passed\n'
