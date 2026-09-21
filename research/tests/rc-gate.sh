#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export PYTHONPATH="$ROOT/research${PYTHONPATH:+:$PYTHONPATH}"

printf '%s\n' '==> DSH Research V2 RC integration gate'
python research/tests/test_rc_integration.py -v
printf '%s\n' '[✓] V2 RC integration gate passed'
