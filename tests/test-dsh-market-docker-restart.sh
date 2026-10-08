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
grep -Fq 'DSH Docker restart adapter: trust configured reverse-proxy host' "$root/lib/restart.js"
grep -Fq "process.env.DSH_TRUSTED_HOSTS" "$root/lib/restart.js"
grep -Fq 'trustedHosts.has(host)' "$root/lib/restart.js"
grep -Fq 'if (forwardedRequest && !trustedProxyHost) return false' "$root/lib/restart.js"
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


# dshmarket 1.66.11+: directLoopbackRequest is shared by POST authorization and
# GET /status restartReachable; downloads deliberately have their own guard.
shared="$tmp/shared/profiles/web/node_modules/dshmarket"
mkdir -p "$shared/lib" "$shared/src"
printf '%s\n' '{"name":"dshmarket","version":"1.66.11"}' >"$shared/package.json"
cat >"$shared/lib/restart.js" <<'JS'
function loopbackAuthority(host) {
  return host === '127.0.0.1:3080'
}

export function directLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (request.headers.forwarded !== undefined
    || request.headers['x-forwarded-for'] !== undefined
    || request.headers['x-real-ip'] !== undefined) return false
  return loopbackAuthority(request.headers.host)
}

export function restartReachableFrom(request) {
  return directLoopbackRequest(request)
}

export function trustedRestartRequest(request) {
  if (!directLoopbackRequest(request)) return false
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch { return false }
}

export function trustedDownloadRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (request.headers.forwarded !== undefined
    || request.headers['x-forwarded-for'] !== undefined
    || request.headers['x-real-ip'] !== undefined) return false
  if (!loopbackAuthority(request.headers.host)) return false
  return true
}

export function scheduleRestart(port = null, recovery) {
  const launch = restartLaunch()
  const spawned = respawnInvocation(launch)
}
JS
cp "$shared/lib/restart.js" "$shared/src/restart.ts"
DSH_HOME="$tmp/shared" DSH_DOCKER_RESTART=container node "$PATCHER"
grep -Fq 'DSH Docker restart adapter: trust container peer' "$shared/lib/restart.js"
grep -Fq 'DSH Docker restart adapter: trust configured reverse-proxy host' "$shared/lib/restart.js"
grep -Fq 'DSH Docker restart adapter: delegate restart to Docker' "$shared/lib/restart.js"
grep -Fq 'const acceptableHost = loopbackAuthority(host) || trustedProxyHost' "$shared/lib/restart.js"

# Evaluate the patched JS against a simulated Docker bridge. Testing the actual
# guard behavior catches regressions that simple string assertions miss.
node - "$shared/lib/restart.js" <<'NODE'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const source = readFileSync(process.argv[2], 'utf8').replace(/^export /gm, '')
const testProcess = {
  env: { DSH_DOCKER_RESTART: 'container', DSH_TRUSTED_HOSTS: 'dsh.example.com' },
  getBuiltinModule(name) {
    assert.equal(name, 'fs')
    return { readFileSync(path) {
      assert.equal(path, '/proc/net/route')
      return 'Iface Destination Gateway Flags\neth0 00000000 010011AC 0003\n'
    } }
  },
}
const api = runInNewContext(source + '\n({ trustedRestartRequest, restartReachableFrom, trustedDownloadRequest })',
  { process: testProcess, URL })
function request(host, origin, peer, extra = {}) {
  return { socket: { remoteAddress: peer }, headers: { host, origin, ...extra } }
}
const forwarded = { 'x-forwarded-for': '203.0.113.12', 'x-real-ip': '203.0.113.12' }
const proxied = request('dsh.example.com', 'https://dsh.example.com', '172.17.0.1', forwarded)
assert.equal(api.restartReachableFrom(proxied), true)
assert.equal(api.trustedRestartRequest(proxied), true)
assert.equal(api.trustedRestartRequest(request('dsh.example.com', 'https://other.example', '172.17.0.1', forwarded)), false)
assert.equal(api.trustedRestartRequest(request('other.example', 'https://other.example', '172.17.0.1', forwarded)), false)
assert.equal(api.trustedRestartRequest(request('dsh.example.com', 'https://dsh.example.com', '172.17.0.2', forwarded)), false)
assert.equal(api.trustedRestartRequest(request('127.0.0.1:3080', 'http://127.0.0.1:3080', '172.17.0.1', forwarded)), false)
assert.equal(api.trustedRestartRequest(request('127.0.0.1:3080', 'http://127.0.0.1:3080', '172.17.0.1')), true)
assert.equal(api.trustedDownloadRequest(proxied), false, 'backup download must remain loopback-only')
testProcess.env.DSH_DOCKER_RESTART = 'off'
assert.equal(api.trustedRestartRequest(proxied), false)
assert.equal(api.trustedRestartRequest(request('127.0.0.1:3080', 'http://127.0.0.1:3080', '127.0.0.1')), true)
NODE

stable_before="$(sha256sum "$shared/lib/restart.js" | awk '{print $1}')"
DSH_HOME="$tmp/shared" DSH_DOCKER_RESTART=container node "$PATCHER"
stable_after="$(sha256sum "$shared/lib/restart.js" | awk '{print $1}')"
[[ "$stable_before" == "$stable_after" ]]

# Fail closed on a future upstream API change instead of patching the wrong guard.
sed -i 's/return directLoopbackRequest(request)/return false/' "$shared/lib/restart.js"
if DSH_HOME="$tmp/shared" DSH_DOCKER_RESTART=container node "$PATCHER" 2>"$tmp/failed-patch.log"; then
  echo "Expected the incompatible restart guard patch to fail closed" >&2
  exit 1
fi
grep -Fq 'shared restart guard structure changed' "$tmp/failed-patch.log"

echo "dsh-market Docker restart adapter checks passed"
