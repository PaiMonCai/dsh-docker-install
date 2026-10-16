#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Execute the real native branch, with only its temporary path redirected.
awk '/ && if \[ "\$\{BUILDPLATFORM\}" = "\$\{TARGETPLATFORM\}" \]; then/ { active=1; next }
     active && /    else/ { exit }
     active { sub(/\\$/, ""); printf "%s ", $0 }
     END { print "" }' "$root/research/Dockerfile" \
  | sed "s|/tmp/research-smoke|$tmp/research-smoke|g" > "$tmp/native.sh"
test -s "$tmp/native.sh"
quarto() {
  if [[ "$MODE" == fail ]]; then return 42; fi
  if [[ "$MODE" == empty ]]; then return 0; fi
  printf 'pdf\n' > "$tmp/research-smoke.pdf"
}
export -f quarto
export tmp
for mode in fail empty ok; do
  export MODE="$mode"
  if bash "$tmp/native.sh"; then
    [[ "$mode" == ok ]] || { echo "Quarto $mode was accepted" >&2; exit 1; }
  else
    [[ "$mode" != ok ]] || { echo "Valid PDF rejected" >&2; exit 1; }
  fi
done
echo "Quarto failure, empty PDF and successful render checks passed"
