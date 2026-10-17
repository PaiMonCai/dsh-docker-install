import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, openSync, readSync, renameSync, writeFileSync, fsyncSync, fstatSync, closeSync, unlinkSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'

export const SECTION = 'dsh-docker:user-guidance'
export const WORKSPACE_SECTION = 'dsh-docker:workspace-guidance'
export const TOOL_SECTION = 'dsh-docker:tool-policy'
export const LIMIT = 16384
const STATE_SCHEMA = 1
const MAX_STATE_BYTES = LIMIT * 6 + 16384
const OWN_SECTIONS = new Set([SECTION, WORKSPACE_SECTION, TOOL_SECTION])

export function validateDeniedTools(names) {
  if (!Array.isArray(names) || names.length > 64 || names.some(name =>
    typeof name !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(name)))
    throw Error('tool policy requires at most 64 exact tool names')
  return [...new Set(names)].sort()
}

export function statePath(home = process.env.DSH_HOME || '/root/.dsh') {
  return join(home, 'dsh-docker', 'prompt-manager', 'state.json')
}

export function normalizeState(value) {
  if (!value || value.schema !== STATE_SCHEMA || typeof value.globalEnabled !== 'boolean' ||
      typeof value.workspaceEnabled !== 'boolean' || typeof value.globalText !== 'string' ||
      Buffer.byteLength(value.globalText) > LIMIT) throw Error('invalid prompt-manager state')
  return { schema: STATE_SCHEMA, globalEnabled: value.globalEnabled,
    workspaceEnabled: value.workspaceEnabled, globalText: value.globalText,
    deniedTools: validateDeniedTools(value.deniedTools ?? []) }
}

function checkDirectory(home, create = false) {
  let directory = resolve(home || process.env.DSH_HOME || '/root/.dsh')
  for (const part of ['', 'dsh-docker', 'prompt-manager']) {
    if (part) directory = join(directory, part)
    try {
      const stat = lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unsafe prompt-manager directory')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (!create) return false
      mkdirSync(directory, { mode: 0o700 })
    }
  }
  return true
}

function readBounded(file, max) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > max) throw Error('invalid or oversized guidance file')
    const buffer = Buffer.alloc(max + 1)
    let size = 0
    while (size < buffer.length) {
      const n = readSync(fd, buffer, size, buffer.length - size, null)
      if (!n) break
      size += n
    }
    if (size > max) throw Error('oversized guidance file')
    return buffer.subarray(0, size).toString('utf8')
  } finally { if (fd !== undefined) closeSync(fd) }
}

function fileStat(file) {
  try { return lstatSync(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export function readState(home) {
  const file = statePath(home)
  const stat = checkDirectory(home) ? fileStat(file) : null
  if (!stat) return { schema: STATE_SCHEMA, globalEnabled: false,
    workspaceEnabled: false, globalText: '', deniedTools: [] }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES)
    throw Error('unsafe prompt-manager state file')
  const text = readBounded(file, MAX_STATE_BYTES)
  let state
  try { state = JSON.parse(text) }
  catch { throw Error('invalid prompt-manager state JSON') }
  return normalizeState(state)
}

export function revision(state) { return digest(JSON.stringify(normalizeState(state))) }

export function writeState(value, home, expectedRevision) {
  const state = normalizeState(value)
  if (expectedRevision !== undefined && expectedRevision !== revision(readState(home)))
    throw Error('settings changed in another page; refresh before saving')
  const file = statePath(home)
  checkDirectory(home, true)
  const existing = fileStat(file)
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw Error('unsafe prompt-manager state file')
  const temp = file + '.' + randomUUID() + '.tmp'
  let fd
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(state) + '\n')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temp, file)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return state
}

export function readWorkspaceGuidance(cwd, workspaceRoot = '/workspace') {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return { text: '', sources: [], reason: 'missing workspace' }
  try {
    const root = realpathSync(workspaceRoot)
    const directory = realpathSync(cwd)
    const suffix = relative(root, directory)
    if (suffix === '..' || suffix.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(suffix))
      return { text: '', sources: [], reason: 'outside workspace root' }
    const chain = []
    let current = directory
    while (true) {
      chain.unshift(current)
      if (current === root) break
      if (chain.length >= 32) throw Error('workspace depth exceeds 32')
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    const parts = []
    const sources = []
    for (const folder of chain) {
      // Native DSH already discovers and reconciles AGENTS.md. This explicit
      // supplemental file avoids duplicating its baseline in every system prompt.
      const file = join(folder, 'DSH_PROMPT.md')
      const stat = fileStat(file)
      if (!stat) continue
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw Error('unsafe workspace guidance')
      const content = readBounded(file, LIMIT).trim()
      if (content) {
        const source = relative(root, file).replaceAll('\\', '/')
        parts.push('Workspace guidance (' + source + '):\n' + content)
        sources.push(source)
      }
    }
    const text = parts.join('\n\n')
    if (Buffer.byteLength(text) > LIMIT) throw Error('combined workspace guidance exceeds 16 KiB')
    return { text, sources, reason: text ? null : 'no supplemental workspace guidance' }
  } catch { return { text: '', sources: [], reason: 'workspace guidance unavailable, unsafe or over limit' } }
}

export function assemblePrompt(original, state, cwd, workspaceRoot) {
  if (!original || !Array.isArray(original.sections)) return { assembly: original, injected: [] }
  const sections = original.sections.filter(part => !OWN_SECTIONS.has(part?.name))
  const injected = []
  const globalText = state.globalEnabled ? state.globalText.trim() : ''
  if (globalText) {
    sections.push({ name: SECTION, text: globalText, interpolate: false })
    injected.push({ name: SECTION, bytes: Buffer.byteLength(globalText), sha256: digest(globalText) })
  }
  const workspace = state.workspaceEnabled ? readWorkspaceGuidance(cwd, workspaceRoot) : { text: '', sources: [], reason: 'disabled' }
  const workspaceText = workspace.text
  if (workspaceText) {
    sections.push({ name: WORKSPACE_SECTION, text: workspaceText, interpolate: false })
    injected.push({ name: WORKSPACE_SECTION, bytes: Buffer.byteLength(workspaceText), sha256: digest(workspaceText) })
  }
  if (state.deniedTools?.length) {
    const text = 'The user disabled these exact DSH tool capabilities for this instance: ' + state.deniedTools.join(', ') +
      '. Calls to these capabilities are rejected by the tool runtime. Other capabilities retain their existing policy.'
    sections.push({ name: TOOL_SECTION, text, interpolate: false })
    injected.push({ name: TOOL_SECTION, bytes: Buffer.byteLength(text), sha256: digest(text) })
  }
  const changed = injected.length || sections.length !== original.sections.length
  return { assembly: changed ? { ...original, sections } : original, injected,
    workspace: { sources: workspace.sources, reason: workspace.reason } }
}

function digest(text) { return createHash('sha256').update(text, 'utf8').digest('hex') }

export function summary(state, injected, cwd) {
  return { enabled: state.globalEnabled, workspaceEnabled: state.workspaceEnabled,
    configuredBytes: Buffer.byteLength(state.globalText), injected,
    cwd: typeof cwd === 'string' ? cwd : '' }
}
