#!/usr/bin/env bash
set -Eeuo pipefail

manager="docker/plugins/dsh-session-manager/dsh-session-manager"
bash -n "$manager"
bash -n dshd

temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
export DSH_SESSION_DATA_ROOT="$temp/data"
mkdir -p "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first"
printf '%s\n' '{"type":"session","id":"session-first"}' > "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first/session.v4.jsonl"
mkdir -p "$DSH_SESSION_DATA_ROOT/sessions/--other--/session-second"
printf '%s\n' '{"type":"session","id":"session-second"}' > "$DSH_SESSION_DATA_ROOT/sessions/--other--/session-second/session.v4.jsonl.zstd"
mkdir -p "$temp/protected"
ln -s "$temp/protected" "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/unsafe-link"

rows="$(bash "$manager" list)"
grep -Fq -- '--workspace--/session-first' <<< "$rows"
grep -Fq -- '--other--/session-second' <<< "$rows"
if grep -Fq unsafe-link <<< "$rows"; then echo 'symlink incorrectly listed' >&2; exit 1; fi

if bash "$manager" delete '../protected' >/dev/null 2>&1; then echo 'traversal accepted' >&2; exit 1; fi
if bash "$manager" delete '--workspace--/unsafe-link' >/dev/null 2>&1; then echo 'symlink accepted' >&2; exit 1; fi

bash "$manager" delete '--workspace--/session-first' >/dev/null
[[ ! -e "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first" ]]
trash="$(bash "$manager" trash)"
trash_id="${trash%%$'\t'*}"
[[ "$trash_id" == session-* ]]
bash "$manager" restore "$trash_id" >/dev/null
[[ -f "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first/session.v4.jsonl" ]]
[[ -z "$(bash "$manager" trash)" ]]

bash "$manager" delete '--workspace--/session-first' >/dev/null
trash="$(bash "$manager" trash)"
trash_id="${trash%%$'\t'*}"
# Restoring must not overwrite a newly materialized destination.
mkdir -p "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first"
if bash "$manager" restore "$trash_id" >/dev/null 2>&1; then echo 'restore overwrote a session' >&2; exit 1; fi
bash "$manager" purge "$trash_id" >/dev/null
[[ -z "$(bash "$manager" trash)" ]]
[[ -d "$DSH_SESSION_DATA_ROOT/sessions/--workspace--/session-first" ]]

grep -Fq 'COPY docker/plugins/dsh-session-manager/dsh-session-manager' Dockerfile
grep -Fq '28) 会话管理' dshd
grep -Fq 'sessions|session)' dshd
echo 'offline session management checks passed'
