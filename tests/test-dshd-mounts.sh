#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf '[x] %s\n' "$*" >&2
  exit 1
}

test_mount_validation_and_records() (
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  export HOME="$tmp/home"
  export DSHD_STATE_DIR="$tmp/state"
  export DSHD_LIB_ONLY=1
  mkdir -p "$HOME"

  # shellcheck disable=SC1090
  source "$ROOT/dshd"

  validate_custom_mount "$tmp/ssh" /root/.ssh rw     || fail "valid SSH mount rejected: $MOUNT_VALIDATION_ERROR"
  validate_custom_mount "$tmp/cache" /root/.cache ro     || fail "valid read-only mount rejected: $MOUNT_VALIDATION_ERROR"

  if validate_custom_mount relative/path /root/.ssh rw; then
    fail "relative host path should be rejected"
  fi
  if validate_custom_mount "$tmp/data" /root/.dsh rw; then
    fail "/root/.dsh must remain reserved"
  fi
  if validate_custom_mount "$tmp/workspace" /workspace/project rw; then
    fail "/workspace descendants must remain reserved"
  fi
  if validate_custom_mount "$tmp/root" /root rw; then
    fail "/root must remain reserved"
  fi
  if validate_custom_mount "$tmp/ssh" /root/.ssh invalid; then
    fail "invalid mount mode should be rejected"
  fi

  prepare_custom_mount_source "$tmp/ssh" /root/.ssh
  [[ -d "$tmp/ssh" ]] || fail "mount source was not created"
  [[ "$(stat -c '%a' "$tmp/ssh")" == "700" ]] || fail "SSH mount source should be mode 700"

  add_custom_mount_record "$tmp/ssh" /root/.ssh rw
  [[ "$(custom_mount_count)" == "1" ]] || fail "mount count should be 1"
  grep -Fxq "$tmp/ssh|/root/.ssh|rw" "$MOUNTS_FILE" || fail "mount record not persisted"

  if ( add_custom_mount_record "$tmp/ssh-child" /root/.ssh/keys rw ) >/dev/null 2>&1; then
    fail "overlapping custom target should be rejected"
  fi

  remove_custom_mount_record /root/.ssh || fail "mount record removal failed"
  [[ "$(custom_mount_count)" == "0" ]] || fail "mount count should return to 0"
  [[ ! -s "$MOUNTS_FILE" ]] || fail "mount file should be empty after removal"
)

test_mount_validation_and_records

printf '[✓] dshd custom mount tests passed\n'
