#!/usr/bin/env bash
# Apply authenticated Web deletion requests before DSH starts (offline).
set -Eeuo pipefail
export DSH_HOME="${DSH_HOME:-/root/.dsh}"
manager="${DSH_SESSION_MANAGER_BIN:-/usr/local/bin/dsh-session-manager}"
queue_dir="$DSH_HOME/.dshd-session-manager"
pending="$queue_dir/pending"
processing="$queue_dir/processing"
[[ -d "$queue_dir" && ! -L "$queue_dir" ]] || exit 0
[[ ! -L "$pending" && ! -L "$processing" ]] || { echo "session-manager: unsafe pending queue" >&2; exit 2; }
if [[ ! -e "$processing" && -f "$pending" ]]; then mv -- "$pending" "$processing"; fi
[[ -f "$processing" ]] || exit 0
remaining="$(mktemp "$queue_dir/.pending-XXXXXXXX")"
trap 'rm -f -- "$remaining"' EXIT
while IFS= read -r key || [[ -n "$key" ]]; do
  [[ -n "$key" ]] || continue
  if DSH_SESSION_DATA_ROOT="$DSH_HOME" "$manager" delete "$key"; then
    :
  elif [[ ! -d "$DSH_HOME/sessions/$key" ]]; then
    # A request already applied before an interrupted previous boot.
    echo "session-manager: requested session already absent: $key" >&2
  else
    echo "session-manager: cannot remove $key; preserving request" >&2
    printf '%s\n' "$key" >> "$remaining"
  fi
done < "$processing"
if [[ -s "$remaining" ]]; then
  mv -- "$remaining" "$processing"
  echo "session-manager: some deletions could not be applied; DSH starts without retrying until the next boot" >&2
else
  rm -f -- "$processing"
fi
