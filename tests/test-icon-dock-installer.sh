#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash -n docker/ensure-icon-dock.sh

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/home/profiles/web" "$tmp/plugin"
printf '{"name":"dsh-docker-icon-dock"}\n' > "$tmp/plugin/package.json"
cat > "$tmp/home/profiles/web/package.json" <<'JSON'
{"dependencies":{"dshmarket":"1.66.18"},"dsh":{"profile":{"bundles":["dshmarket"]}}}
JSON

cat > "$tmp/bin/dsh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_CALLS"
case "$*" in
  'plugin --profile web add '*)
    if [[ "$FAKE_FAIL" == age ]]; then
      echo 'Lockfile failed supply-chain policy check (21 entries)' >&2
      echo '[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] dshmarket@1.66.18 was published too recently' >&2
      exit 1
    fi
    if [[ "$FAKE_FAIL" == generic ]]; then echo 'network unavailable' >&2; exit 1; fi
    node - "$DSH_HOME/profiles/web/package.json" <<'NODE'
const fs=require('node:fs')
const p=process.argv[2]
const d=JSON.parse(fs.readFileSync(p,'utf8'))
d.dependencies['dsh-docker-icon-dock']='link:/opt/dsh/plugins/dsh-icon-dock'
d.dsh.profile.bundles.push('dsh-docker-icon-dock')
fs.writeFileSync(p,JSON.stringify(d))
NODE
    ;;
  'plugin --profile web remove dsh-docker-icon-dock')
    node - "$DSH_HOME/profiles/web/package.json" <<'NODE'
const fs=require('node:fs')
const p=process.argv[2]
const d=JSON.parse(fs.readFileSync(p,'utf8'))
delete d.dependencies['dsh-docker-icon-dock']
d.dsh.profile.bundles=d.dsh.profile.bundles.filter(n=>n!=='dsh-docker-icon-dock')
fs.writeFileSync(p,JSON.stringify(d))
NODE
    ;;
  *) echo 'unexpected mock dsh arguments' >&2; exit 2 ;;
esac
SCRIPT
chmod +x "$tmp/bin/dsh"
export DSH_HOME="$tmp/home" DSH_ICON_DOCK_PACKAGE_DIR="$tmp/plugin"
export FAKE_CALLS="$tmp/calls" FAKE_FAIL="" PATH="$tmp/bin:$PATH"

before="$(cat "$DSH_HOME/profiles/web/package.json")"
if FAKE_FAIL=age bash docker/ensure-icon-dock.sh >"$tmp/out" 2>&1; then
  echo "age-policy failure unexpectedly passed" >&2
  exit 1
fi
grep -Fq 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION' "$tmp/out"
grep -Fq 'Keep pnpm-lock.yaml and profile data intact' "$tmp/out"
[[ "$(cat "$DSH_HOME/profiles/web/package.json")" == "$before" ]]
[[ ! -e "$DSH_HOME/profiles/web/pnpm-workspace.yaml" ]]

if FAKE_FAIL=generic bash docker/ensure-icon-dock.sh >"$tmp/out" 2>&1; then
  echo "network failure unexpectedly passed" >&2
  exit 1
fi
grep -Fq 'network unavailable' "$tmp/out"
[[ "$(cat "$DSH_HOME/profiles/web/package.json")" == "$before" ]]

bash docker/ensure-icon-dock.sh >"$tmp/out" 2>&1
grep -Fq 'installed and selected' "$tmp/out"
node - "$DSH_HOME/profiles/web/package.json" <<'NODE'
const p=require(process.argv[2])
if (!p.dependencies['dsh-docker-icon-dock'] ||
 !p.dsh.profile.bundles.includes('dsh-docker-icon-dock')) process.exit(1)
NODE
calls="$(wc -l <"$FAKE_CALLS")"
bash docker/ensure-icon-dock.sh >"$tmp/out" 2>&1
[[ "$(wc -l <"$FAKE_CALLS")" -eq "$calls" ]]

DSH_ICON_DOCK_ENABLED=false bash docker/ensure-icon-dock.sh >"$tmp/out" 2>&1
node - "$DSH_HOME/profiles/web/package.json" <<'NODE'
const p=require(process.argv[2])
if (p.dependencies['dsh-docker-icon-dock'] ||
 p.dsh.profile.bundles.includes('dsh-docker-icon-dock') ||
 p.dependencies.dshmarket !== '1.66.18') process.exit(1)
NODE
echo 'Icon Dock installer integration checks passed'
