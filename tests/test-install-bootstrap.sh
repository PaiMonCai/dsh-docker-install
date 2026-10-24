#!/usr/bin/env bash
# No network, Docker or installed DSH is needed for these bootstrap regressions.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
command -v setsid >/dev/null || { echo "setsid is required for no-TTY startup test" >&2; exit 1; }

mkdir -p "$tmp/local" "$tmp/piped" "$tmp/bin"
cp "$ROOT/install.sh" "$tmp/local/install.sh"

cat >"$tmp/local/dshd" <<'STUB'
#!/usr/bin/env bash
printf 'LOCAL:%s:%s\n' "${1:-}" "${2:-}"
STUB
cp "$tmp/local/dshd" "$tmp/piped/dshd"
cat >"$tmp/remote-dshd" <<'STUB'
#!/usr/bin/env bash
printf 'REMOTE:%s:%s\n' "${1:-}" "${2:-}"
STUB
cat >"$tmp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
cat "$MOCK_REMOTE_DSHD"
MOCK
chmod +x "$tmp/local/dshd" "$tmp/piped/dshd" "$tmp/bin/curl"

# setsid drops the controlling terminal, but /dev/tty may still be readable
# according to "test -r" (that is not sufficient to redirect from it).
local_output="$(setsid bash "$tmp/local/install.sh" </dev/null 2>&1)" || {
  printf 'Local installer startup failed without controlling TTY:\n%s\n' "$local_output" >&2
  exit 1
}
[[ "$local_output" == 'LOCAL:install:' ]] || {
  printf 'Unexpected local bootstrap result: %s\n' "$local_output" >&2
  exit 1
}

reverse_output="$(setsid bash "$tmp/local/install.sh" reverse </dev/null 2>&1)" || {
  printf 'Reverse installer startup failed without controlling TTY:\n%s\n' "$reverse_output" >&2
  exit 1
}
[[ "$reverse_output" == 'LOCAL:reverse:install' ]] || {
  printf 'Unexpected reverse bootstrap result: %s\n' "$reverse_output" >&2
  exit 1
}

# Piping install.sh into bash must fetch the remote manager and must not
# accidentally execute an unrelated (possibly stale) ./dshd from cwd.
piped_output="$(
  cd "$tmp/piped"
  cat "$tmp/local/install.sh" |
    env PATH="$tmp/bin:$PATH" MOCK_REMOTE_DSHD="$tmp/remote-dshd" setsid bash
)" || {
  printf 'Piped bootstrap failed without controlling TTY:\n%s\n' "$piped_output" >&2
  exit 1
}
[[ "$piped_output" == *'REMOTE:install:'* ]] || {
  printf 'Piped bootstrap did not run downloaded manager: %s\n' "$piped_output" >&2
  exit 1
}
[[ "$piped_output" != *'LOCAL:'* ]] || {
  printf 'Piped bootstrap executed a local shadow dshd: %s\n' "$piped_output" >&2
  exit 1
}

echo 'test-install-bootstrap: ok'
