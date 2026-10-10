#!/usr/bin/env bash
# Print exactly true for a Research-only push, false for a mixed push.
set -Eeuo pipefail
if (( $# != 2 )); then
  echo "usage: research-push-gate.sh <before-sha> <after-sha>" >&2
  exit 2
fi
before="$1"
after="$2"
valid='^[0-9a-fA-F]{40}$'
if [[ ! "$before" =~ $valid || ! "$after" =~ $valid ]]; then
  echo "invalid before/after commit sha" >&2
  exit 2
fi
if [[ "$before" == 0000000000000000000000000000000000000000 ]]; then
  echo true
  exit 0
fi
git cat-file -e "$before^{commit}"
git cat-file -e "$after^{commit}"
standard_paths=(
  Dockerfile
  docker
  ci
  dshd
  install.sh
  docker-compose.yml
  .env.example
  docs
  tests
  .github/workflows/build.yml
)
if git diff --quiet "$before" "$after" -- "${standard_paths[@]}"; then
  echo true
else
  status=$?
  if (( status != 1 )); then
    echo "git diff failed with status $status" >&2
    exit "$status"
  fi
  echo false
fi
