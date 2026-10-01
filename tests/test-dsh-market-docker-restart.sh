#!/usr/bin/env bash
set -euo pipefail

PATCHER="docker/patch-dsh-market-container-restart.js"

node --check "$PATCHER"
node "$PATCHER" --self-test

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

root="$tmp/profiles/web/node_modules/dshmarket"
mkdir -p "$root/lib" "$root/src"
cat >"$root/package.json" <<'JSON'
{"name":"dshmarket","version":"test"}
JSON

cat >"$root/lib/restart.js" <<'JS'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function loopbackAuthority(host) {
  return host === '127.0.0.1:3080'
}

export function trustedRestartRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (request.headers.forwarded !== undefined
    || request.headers['x-forwarded-for'] !== undefined
    || request.headers['x-real-ip'] !== undefined) return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!loopbackAuthority(host)) return false;
  if (origin === undefined || host === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch {
    return false;
  }
}

export function scheduleRestart(port = null, recovery) {
  const launch = restartLaunch();
  const spawned = respawnInvocation(launch);
  return { launch, spawned, port, recovery };
}
JS

cp "$root/lib/restart.js" "$root/src/restart.ts"

before="$(sha256sum "$root/lib/restart.js" | awk '{print $1}')"
DSH_HOME="$tmp" DSH_DOCKER_RESTART=container node "$PATCHER"
after="$(sha256sum "$root/lib/restart.js" | awk '{print $1}')"
[[ "$before" != "$after" ]]

grep -Fq 'DSH Docker restart adapter: trust container peer' "$root/lib/restart.js"
grep -Fq 'DSH Docker restart adapter: delegate restart to Docker' "$root/lib/restart.js"
grep -Fq "process.env.DSH_DOCKER_RESTART === 'container'" "$root/lib/restart.js"
grep -Fq "if (!loopbackPeer && !dockerPeer) return false" "$root/lib/restart.js"
grep -Fq "process.getBuiltinModule('fs')?.readFileSync('/proc/net/route', 'utf8')" "$root/lib/restart.js"
grep -Fq "request.headers['x-forwarded-for']" "$root/lib/restart.js"
grep -Fq 'loopbackAuthority(host)' "$root/lib/restart.js"
grep -Fq "process.kill(process.pid, 'SIGTERM')" "$root/lib/restart.js"

stable_before="$(sha256sum "$root/lib/restart.js" | awk '{print $1}')"
DSH_HOME="$tmp" DSH_DOCKER_RESTART=container node "$PATCHER"
stable_after="$(sha256sum "$root/lib/restart.js" | awk '{print $1}')"
[[ "$stable_before" == "$stable_after" ]]

grep -Fq 'DSH_DOCKER_RESTART: "container"' docker-compose.yml
grep -Fq -- '-e "DSH_DOCKER_RESTART=container"' dshd
grep -Fq 'apply_dsh_market_container_restart_patch' docker/entrypoint.sh
grep -Fq 'patch-dsh-market-container-restart.js /usr/local/bin/patch-dsh-market-container-restart.js' Dockerfile
grep -Fq 'restart: unless-stopped' docker-compose.yml
grep -Fq -- '--restart unless-stopped' dshd

echo "dsh-market Docker restart adapter checks passed"
