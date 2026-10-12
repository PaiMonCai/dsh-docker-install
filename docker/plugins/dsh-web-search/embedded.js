/** Embedded SearXNG process, launched only by the enabled Web Search plugin.
 * Shares the DSH container network and HTTP(S)_PROXY environment. Never publishes a port.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, lstat, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { request } from 'node:http'

export const SEARCH_PORT = 18788
export const SEARCH_ENDPOINT = 'http://127.0.0.1:' + SEARCH_PORT
const EXEC = '/opt/dsh/searxng-venv/bin/granian'
const SOURCE = '/opt/dsh/searxng-src'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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
    ].join('\\n')
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
    const child = this.spawnProcess(this.executable, [
      '--interface', 'wsgi', '--host', '127.0.0.1', '--port', String(SEARCH_PORT),
      '--workers', '1', 'searx.webapp:app',
    ], { cwd: this.source, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SEARXNG_SETTINGS_PATH: settings,
        NO_PROXY: ['127.0.0.1', 'localhost', process.env.NO_PROXY || ''].filter(Boolean).join(','),
        no_proxy: ['127.0.0.1', 'localhost', process.env.no_proxy || ''].filter(Boolean).join(',') } })
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
    throw new Error('Embedded SearXNG failed to start: ' + (this.lastError?.message || child.exitCode || 'timeout'))
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
    } finally { this.stopping = false }
  }
}
