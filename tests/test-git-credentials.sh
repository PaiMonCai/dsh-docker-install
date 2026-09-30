#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

test_dshd_managed_credentials() (
  local tmp key known mode
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  export DSHD_NO_SELF_UPDATE=1
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"

  key="$tmp/id_ed25519"
  cat >"$key" <<'EOF'
-----BEGIN OPENSSH PRIVATE KEY-----
test-only-placeholder
-----END OPENSSH PRIVATE KEY-----
EOF

  cmd_credentials github-ssh set "$key"
  [[ -f "$GITHUB_SSH_KEY_FILE" ]] || fail "managed SSH key was not created"
  mode="$(stat -c '%a' "$GITHUB_SSH_KEY_FILE")"
  [[ "$mode" == "600" ]] || fail "managed SSH key mode should be 600, got $mode"
  grep -q 'PRIVATE KEY' "$GITHUB_SSH_KEY_FILE" || fail "managed SSH key content mismatch"

  known="$tmp/known_hosts"
  printf 'github.com ssh-ed25519 AAAATEST\n' >"$known"
  cmd_credentials known-hosts set "$known"
  [[ -f "$SSH_KNOWN_HOSTS_FILE" ]] || fail "known_hosts was not created"
  grep -q '^github.com ' "$SSH_KNOWN_HOSTS_FILE" || fail "known_hosts content mismatch"

  cmd_credentials git-identity set "CI User" "ci@example.com"
  grep -q '^DSH_GIT_USER_NAME=CI\\ User$' "$CONFIG_FILE" || fail "git user.name was not persisted"
  grep -q '^DSH_GIT_USER_EMAIL=ci@example.com$' "$CONFIG_FILE" || fail "git user.email was not persisted"

  cmd_credentials strict-host-key set yes
  grep -q '^DSH_GIT_SSH_STRICT_HOST_KEY_CHECKING=yes$' "$CONFIG_FILE" || fail "strict host key policy was not persisted"

  cmd_credentials github-ssh clear
  [[ ! -e "$GITHUB_SSH_KEY_FILE" ]] || fail "managed SSH key was not cleared"
)

test_entrypoint_env_fallback() (
  local tmp raw b64
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/root-home"

  raw=$'-----BEGIN OPENSSH PRIVATE KEY-----\nenv-test-placeholder\n-----END OPENSSH PRIVATE KEY-----\n'
  b64="$(printf '%s' "$raw" | base64 -w0)"

  HOME="$tmp/root-home" \
  DSH_HOME="$tmp/dsh-home" \
  DSH_GIT_RUNTIME_DIR="$tmp/run" \
  DSH_GITHUB_SSH_KEY_B64="$b64" \
  DSH_GIT_USER_NAME="CI User" \
  DSH_GIT_USER_EMAIL="ci@example.com" \
  bash "$ROOT/docker/entrypoint.sh" bash -c '
    set -e
    test -f "$DSH_GIT_RUNTIME_DIR/id_git"
    test "$(stat -c "%a" "$DSH_GIT_RUNTIME_DIR/id_git")" = "600"
    grep -q "Host github.com" "$DSH_GIT_RUNTIME_DIR/ssh_config"
    grep -q "StrictHostKeyChecking accept-new" "$DSH_GIT_RUNTIME_DIR/ssh_config"
    test "$(git config --global --get user.name)" = "CI User"
    test "$(git config --global --get user.email)" = "ci@example.com"
    test -n "$GIT_SSH_COMMAND"
  '
)

test_entrypoint_rejects_invalid_base64() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/root-home"

  if HOME="$tmp/root-home" \
    DSH_HOME="$tmp/dsh-home" \
    DSH_GIT_RUNTIME_DIR="$tmp/run" \
    DSH_GITHUB_SSH_KEY_B64='not@@base64' \
    bash "$ROOT/docker/entrypoint.sh" true >/dev/null 2>&1; then
    fail "entrypoint should reject invalid DSH_GITHUB_SSH_KEY_B64"
  fi
)

test_dshd_managed_credentials
test_entrypoint_env_fallback
test_entrypoint_rejects_invalid_base64

printf '[✓] Git/SSH credential tests passed\n'
