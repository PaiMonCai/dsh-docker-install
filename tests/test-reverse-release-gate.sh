#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gate="$root/ci/reverse-push-gate.sh"
bash -n "$gate"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q -b main
git -C "$tmp" config user.name "CI"
git -C "$tmp" config user.email "ci@example.test"
mkdir -p "$tmp/reverse" "$tmp/docs" "$tmp/.github/workflows"
printf 'standard\n' > "$tmp/Dockerfile"
printf 'reverse\n' > "$tmp/reverse/VERSION"
printf 'docs\n' > "$tmp/docs/ci.md"
printf 'workflow\n' > "$tmp/.github/workflows/build.yml"
git -C "$tmp" add .
git -C "$tmp" commit -qm init
before="$(git -C "$tmp" rev-parse HEAD)"
assert_gate() {
  local expected="$1" a="$2" b="$3" actual
  actual="$(cd "$tmp"; bash "$gate" "$a" "$b")"
  if [[ "$actual" != "$expected" ]]; then
    echo "gate: wanted $expected, got $actual" >&2
    exit 1
  fi
}
echo "next" > "$tmp/reverse/VERSION"
git -C "$tmp" commit -qam reverse
reverse_sha="$(git -C "$tmp" rev-parse HEAD)"
assert_gate true "$before" "$reverse_sha"
echo "base2" > "$tmp/Dockerfile"
echo "core2" > "$tmp/reverse/VERSION"
git -C "$tmp" commit -qam mixed
mixed_sha="$(git -C "$tmp" rev-parse HEAD)"
assert_gate false "$reverse_sha" "$mixed_sha"
echo "reverse3" > "$tmp/reverse/VERSION"
git -C "$tmp" commit -qam reverse-only
reverse_only="$(git -C "$tmp" rev-parse HEAD)"
assert_gate true "$mixed_sha" "$reverse_only"
echo "docs2" > "$tmp/docs/ci.md"
git -C "$tmp" commit -qam docs
docs_sha="$(git -C "$tmp" rev-parse HEAD)"
assert_gate false "$reverse_only" "$docs_sha"
assert_gate true "0000000000000000000000000000000000000000" "$docs_sha"
if (cd "$tmp"; bash "$gate" not-a-sha "$docs_sha") >/dev/null 2>&1; then
  echo "gate accepted invalid SHA" >&2
  exit 1
fi
echo "Reverse/Standard push split gate checks passed"
