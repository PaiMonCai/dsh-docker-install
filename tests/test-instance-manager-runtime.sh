#!/usr/bin/env bash
# Isolated Linux/Docker acceptance. Run as root against the locally built audit image.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'This isolated Docker test requires root.' >&2; exit 1; }
root="$(mktemp -d /tmp/dsh-manager-ci.XXXXXXXX)"
name="dsh-manager-ci-$$"
fixture="dsh-manager-fixture:$$"
real_docker="$(command -v docker)"
worker=""
cleanup() {
  if [[ -n "$worker" ]]; then kill "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; fi
  "$real_docker" rm -f "$name" "$name-rollback" "$name-rollback-pending" "$name-rollback-failed" >/dev/null 2>&1 || true
  "$real_docker" image rm "$fixture" >/dev/null 2>&1 || true
  [[ "$root" == /tmp/dsh-manager-ci.* ]] && rm -rf -- "$root"
}
trap cleanup EXIT
mkdir -p "$root/bin"
# Only registry transport is substituted; inspect, stop, rename, run and healthchecks use real Docker.
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\nreal=%q\nfixture=%q\n' "$real_docker" "$fixture"
  cat <<'WRAPPER'
if [[ "${1:-}" == pull && "${2:-}" == "$fixture" ]]; then exit 0; fi
if [[ "${1:-}" == manifest && "${2:-}" == inspect ]]; then
  exec "$real" image inspect "$fixture" --format '{"Descriptor":{"platform":{"os":"{{.Os}}","architecture":"{{.Architecture}}"}},"OCIManifest":{"config":{"digest":"{{.Id}}"}}}'
fi
exec "$real" "$@"
WRAPPER
} >"$root/bin/docker"
chmod 755 "$root/bin/docker"
export PATH="$root/bin:$PATH"
docker tag "${1:-dsh-ci:pr}" "$fixture"
export DSHD_STATE_DIR="$root/state" DSHD_LIB_ONLY=1 DSHD_NO_SELF_UPDATE=1
source ./dshd
load_config
DSH_NAME="$name"
DSH_IMAGE="$fixture"
DSH_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
DSH_WORKSPACE="$root/workspace"
DSH_DATA_DIR="$root/data"
DSH_STORAGE_MODE=bind
DSH_TRUSTED_HOSTS=""
DSH_DOCKER_ACCESS=false
save_config
mkdir -p "$STATE_DIR/web-management/requests" "$STATE_DIR/web-management/results"
touch "$STATE_DIR/web-management.enabled"
if ! create_container >"$root/bootstrap.log" 2>&1; then
  echo 'Isolated DSH instance failed to start.' >&2
  exit 1
fi
python3 docker/dsh-web-manager.py --state-dir "$STATE_DIR" --dshd "$PWD/dshd" >"$root/worker.log" 2>&1 &
worker=$!
export DSH_CI_MANAGER_NAME="$name" DSH_CI_MANAGER_PORT="$DSH_PORT" DSH_CI_MANAGER_IMAGE="$fixture"
node - <<'NODE'
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const name = process.env.DSH_CI_MANAGER_NAME
const image = process.env.DSH_CI_MANAGER_IMAGE
const base = 'http://127.0.0.1:' + process.env.DSH_CI_MANAGER_PORT
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const token = docker('exec', name, 'node', '/usr/local/bin/dsh-web-token.js', 'print')
const pause = () => new Promise(resolve => setTimeout(resolve, 1000))
let cookie = ''
async function call(data) {
  const response = await fetch(base + '/api/dsh-docker-instance-manager', {
    signal: AbortSignal.timeout(5000), headers: { cookie,
      ...(data ? { 'content-type': 'application/json', 'x-dsh-management': '1' } : {}) },
    ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw Error('Management HTTP ' + response.status)
  return result
}
async function until(fn, timeout = 240000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result } catch {}
    await pause()
  }
  throw Error('Timed out waiting for instance task')
}
async function task(action) {
  const id = randomUUID()
  await call({ id, action, arguments: {} })
  return until(async () => {
    const job = (await call()).jobs.find(job => job.id === id)
    return job && !['running', 'queued'].includes(job.state) ? job : null
  })
}
;(async () => {
  const login = await fetch(base + '/?token=' + encodeURIComponent(token), { redirect: 'manual' })
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'normal DSH browser authentication must succeed')
  await until(async () => (await call()).online)
  assert.equal((await task('restart')).state, 'succeeded')
  await until(async () => !(await call()).jobs.some(job => ['running', 'queued'].includes(job.state)))
  const oldId = docker('inspect', '-f', '{{.Id}}', name)
  const goodImage = docker('commit', '--change', 'LABEL io.dsh.ci.generation=2', name, image)
  assert.equal((await task('check')).state, 'succeeded')
  await until(async () => (await call()).status.release?.available === true)
  const update = await task('update')
  assert.equal(update.state, 'succeeded', update.error)
  assert.notEqual(docker('inspect', '-f', '{{.Id}}', name), oldId)
  assert.equal(docker('inspect', '-f', '{{.Image}}', name), goodImage)
  assert.equal(docker('exec', name, 'node', '/usr/local/bin/dsh-web-token.js', 'print'), token)
  assert.ok(!docker('inspect', '-f', '{{json .Mounts}}', name).includes('docker.sock'))
  assert.ok(!JSON.stringify((await call()).jobs).includes(token), 'task history must not expose the login token')
  // A real unhealthy replacement must restore the accepted image and keep the task result.
  const health = '/usr/local/bin/dsh-healthcheck.js'
  docker('exec', name, 'cp', health, '/tmp/ci-saved-healthcheck.js')
  try {
    docker('exec', name, 'node', '-e', 'require("node:fs").writeFileSync(process.argv[1],"process.exit(1)\\n")', health)
    docker('commit', name, image)
  } finally {
    docker('exec', name, 'mv', '/tmp/ci-saved-healthcheck.js', health)
  }
  const failed = await task('update')
  assert.equal(failed.state, 'failed')
  assert.equal(docker('inspect', '-f', '{{.Image}}', name), goodImage)
  assert.ok((await call()).jobs.some(job => job.id === failed.id && job.state === 'failed'))
  console.log('PASS: authenticated Web -> host executor -> restart/update/health failure recovery, no Docker socket')
})().catch(error => { console.error(String(error.message).replaceAll(token, '[hidden]')); process.exitCode = 1 })
NODE
kill -0 "$worker"
