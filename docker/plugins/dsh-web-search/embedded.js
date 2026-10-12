/** Embedded SearXNG process, launched only by the enabled Web Search plugin.
 * Shares the DSH container network and HTTP(S)_PROXY environment. Never publishes a port.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, lstat, open, copyFile, chown, chmod, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { request } from 'node:http'
import { tmpdir } from 'node:os'

export const SEARCH_PORT = 18788
export const SEARCH_ENDPOINT = 'http://127.0.0.1:' + SEARCH_PORT
const EXEC = '/opt/dsh/searxng-venv/bin/granian'
const SOURCE = '/opt/dsh/searxng-src'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const SEARCH_UID = 991
const SEARCH_GID = 991

// Pass through only the network settings the search child needs. In particular,
// never inherit DSH's model API keys, credentials or Docker host variables.
export function childEnvironment(settings, source = process.env) {
  const env = { PATH: source.PATH || '/usr/bin:/bin', HOME: '/var/cache/searxng',
    XDG_CACHE_HOME: '/var/cache/searxng', LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1',
    SEARXNG_SETTINGS_PATH: settings }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'TZ',
    'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE']) {
    if (source[key]) env[key] = source[key]
  }
  env.NO_PROXY = ['127.0.0.1', 'localhost', env.NO_PROXY || ''].filter(Boolean).join(',')
  env.no_proxy = ['127.0.0.1', 'localhost', env.no_proxy || ''].filter(Boolean).join(',')
  return env
}

async function noSymlink(path, kind) {
  const st = await lstat(path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
  if (st && (st.isSymbolicLink() || !(kind === 'file' ? st.isFile() : st.isDirectory()))) {
    throw new Error('Unsafe embedded search path: ' + path)
  }
  return st
}
export async function ensureSearxSettings(home) {
  const root = join(home, 'web-search')
  const dir = join(root, 'searxng')
  await noSymlink(root, 'dir')
  await mkdir(root, { recursive: true, mode: 0o700 })
  await noSymlink(dir, 'dir')
  await mkdir(dir, { mode: 0o700, recursive: true })
  const file = join(dir, 'settings.yml')
  if (!await noSymlink(file, 'file')) {
    const text = [
      'use_default_settings:',
      '  engines:',
      '    remove:',
      '      - ahmia',
      '      - torch',
      'general:',
      '  debug: false',
      'search:',
      '  formats: [html, json]',
      'server:',
      '  public_instance: false',
      '  limiter: false',
      '  secret_key: "' + randomBytes(32).toString('hex') + '"',
      '',
    ].join('\n')
    const fd = await open(file, 'wx', 0o600).catch(e => e.code === 'EEXIST' ? null : Promise.reject(e))
    if (fd) {
      try { await fd.writeFile(text); await fd.sync() }
      finally { await fd.close() }
    }
  }
  const existing = await noSymlink(file, 'file')
  if (!existing || existing.size > 128 * 1024) throw new Error('Invalid embedded SearXNG settings file')
  // Do not log or return the secret; paths alone are safe to log.
  return file
}
function probe(port = SEARCH_PORT) {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 900 },
      res => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500) })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}
export class EmbeddedSearxng {
  constructor({ home = process.env.DSH_HOME || '/root/.dsh', executable = EXEC,
    source = SOURCE, spawnProcess = spawn, health = probe, log = console.error } = {}) {
    this.home = home
    this.executable = executable
    this.source = source
    this.spawnProcess = spawnProcess
    this.health = health
    this.log = log
    this.child = null
    this.pending = null
    this.lastError = null
    this.stopping = false
    this.runtimeDir = null
  }
  async running() { return this.health() }
  async ensureStarted() {
    if (await this.health()) return
    if (this.pending) return this.pending
    this.pending = this.launch()
    try { await this.pending } finally { this.pending = null }
  }
  async launch() {
    const settings = await ensureSearxSettings(this.home)
    if (this.child?.exitCode === null && !this.child.killed) throw new Error('Search process is not ready')
    this.lastError = null
    // Parent DSH_HOME stays 0700/root-owned. A private ephemeral config copy
    // is given to the unprivileged search UID; no need to open DSH credentials.
    const runtimeDir = await mkdtemp(join(tmpdir(), 'dsh-searxng-'))
    this.runtimeDir = runtimeDir
    await chown(runtimeDir, SEARCH_UID, SEARCH_GID)
    await chmod(runtimeDir, 0o700)
    const runtimeSettings = join(runtimeDir, 'settings.yml')
    await copyFile(settings, runtimeSettings)
    await chown(runtimeSettings, SEARCH_UID, SEARCH_GID)
    await chmod(runtimeSettings, 0o600)
    // get_yaml_cfg resolves limiter.toml relative to SEARXNG_SETTINGS_PATH,
    // not /etc/searxng. Ship the disabled limiter template beside the private
    // runtime config to avoid the otherwise misleading missing-file warning.
    const limiter = join(runtimeDir, 'limiter.toml')
    await copyFile('/etc/searxng/limiter.toml', limiter)
    await chown(limiter, SEARCH_UID, SEARCH_GID)
    await chmod(limiter, 0o600)
    const child = this.spawnProcess(this.executable, [
      '--interface', 'wsgi', '--host', '127.0.0.1', '--port', String(SEARCH_PORT),
      '--workers', '1', 'searx.webapp:app',
    ], { cwd: this.source, stdio: ['ignore', 'pipe', 'pipe'],
      uid: SEARCH_UID, gid: SEARCH_GID,
      env: childEnvironment(runtimeSettings) })
    this.child = child
    child.once('error', error => { this.lastError = error })
    child.once('exit', (code, signal) => {
      if (!this.stopping) this.log('embedded SearXNG exited: ' + (signal || code))
      if (this.child === child) this.child = null
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', bytes => this.log('embedded SearXNG: ' + String(bytes).trim().slice(0, 2048)))
    }
    for (let i = 0; i < 50; i++) {
      if (await this.health()) { this.log('embedded SearXNG ready on loopback'); return }
      if (this.lastError || child.exitCode !== null) break
      await sleep(200)
    }
    const reason = this.lastError?.message || child.exitCode || 'timeout'
    child.kill('SIGTERM')
    throw new Error('Embedded SearXNG failed to start: ' + reason)
  }
  async stop() {
    this.stopping = true
    try {
      if (this.pending) await this.pending.catch(() => {})
      const child = this.child
      if (!child || child.exitCode !== null) return
      child.kill('SIGTERM')
      for (let i = 0; i < 15 && child.exitCode === null; i++) await sleep(100)
      if (child.exitCode === null) child.kill('SIGKILL')
    } finally {
      if (this.runtimeDir) {
        await rm(this.runtimeDir, { recursive: true, force: true }).catch(() => {})
        this.runtimeDir = null
      }
      this.stopping = false
    }
  }
}
