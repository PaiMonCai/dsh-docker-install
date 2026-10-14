/** Reverse Prompt Manager — filesystem state + pure section transformation. MIT-style original implementation. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, openSync, writeSync, closeSync, unlinkSync, fsyncSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
export const SECTION = 'reverse:prompt-manager-guidance'
export const SCHEMA = 1
export const LIMIT = 12288
const builtinRoot = join(dirname(fileURLToPath(import.meta.url)), 'presets')
const DEFAULT = { schema: 1, enabled: false, active: 'evidence' }
export function root(home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
  return join(home, 'reverse-engineering', 'prompt-manager')
}
function slug(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(name) || name.includes('--'))
    throw Error('invalid preset name; use lowercase letters, numbers and hyphens')
  return name
}
function readSmall(path) {
  if (!existsSync(path)) return undefined
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > 18000) throw Error('invalid prompt configuration file: ' + path)
  return JSON.parse(readFileSync(path, 'utf8'))
}
function normalizeState(s) {
  if (!s || s.schema !== 1 || typeof s.enabled !== 'boolean' || typeof s.active !== 'string')
    throw Error('invalid prompt state')
  return { schema: 1, enabled: s.enabled, active: slug(s.active) }
}
function normalizePreset(p, name) {
  if (!p || p.schema !== 1 || p.name !== name || typeof p.title !== 'string' ||
      !p.title.trim() || Buffer.byteLength(p.title) > 120 ||
      !['append', 'replace-persona'].includes(p.mode) ||
      typeof p.text !== 'string' || !p.text.trim() || Buffer.byteLength(p.text) > LIMIT)
    throw Error('invalid prompt preset: ' + name)
  if (/{{[^{}]*}}/.test(p.text)) throw Error('DSH {{variable}} syntax is not supported in custom prompts')
  return { schema: 1, name, title: p.title.trim(), mode: p.mode, text: p.text }
}
function builtIn(name) { return join(builtinRoot, slug(name) + '.json') }
function userFile(name, home) { return join(root(home), 'presets', slug(name) + '.json') }
export function listPresets(home) {
  const set = new Set()
  for (const folder of [builtinRoot, join(root(home), 'presets')]) {
    if (existsSync(folder)) for (const name of readdirSync(folder)) {
      if (/^[a-z][a-z0-9-]{0,47}\.json$/.test(name)) set.add(name.slice(0, -5))
    }
  }
  return [...set].sort()
}
export function loadPreset(name, home) {
  name = slug(name)
  const file = userFile(name, home)
  const data = readSmall(existsSync(file) ? file : builtIn(name))
  if (!data) throw Error('unknown prompt preset: ' + name)
  return normalizePreset(data, name)
}
export function readState(home) {
  const data = readSmall(join(root(home), 'state.json'))
  return data === undefined ? { ...DEFAULT } : normalizeState(data)
}
export function readActive(home) {
  const state = readState(home)
  return { state, preset: state.enabled ? loadPreset(state.active, home) : null }
}
function atomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path) && !lstatSync(path).isFile()) throw Error('unsafe destination')
  const tmp = path + '.' + randomUUID() + '.tmp'
  let fd
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeSync(fd, contents)
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(tmp, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(tmp)) unlinkSync(tmp)
  }
}
export function writeState(state, home) {
  const safe = normalizeState(state)
  if (safe.enabled) loadPreset(safe.active, home)
  atomic(join(root(home), 'state.json'), JSON.stringify(safe, null, 2) + '\n')
  return safe
}
export function importPreset(name, text, home, mode = 'append') {
  name = slug(name)
  if (existsSync(builtIn(name))) throw Error('built-in presets are read-only')
  const p = normalizePreset({ schema: 1, name, title: name, mode, text }, name)
  atomic(userFile(name, home), JSON.stringify(p, null, 2) + '\n')
  return p
}
export function removePreset(name, home) {
  const state = readState(home)
  if (state.active === name && state.enabled) throw Error('disable or switch the active preset first')
  if (existsSync(builtIn(name))) throw Error('built-in presets are read-only')
  const path = userFile(name, home)
  if (!existsSync(path) || !lstatSync(path).isFile()) throw Error('unknown user preset')
  unlinkSync(path)
}
export function fingerprint(p) {
  return createHash('sha256').update(p.mode + '\n' + p.text).digest('hex').slice(0, 16)
}
/** Both runtime and offline previews use this immutable transformer. */
export function applyPreset(sections, preset) {
  if (!Array.isArray(sections)) return { changed: false, reason: 'missing sections', sections }
  const n = sections.findIndex(row => row?.name === 'deployment:persona-prefix')
  if (n < 0 || typeof sections[n].text !== 'string' ||
      !sections[n].text.startsWith('You are Reverse Engineer'))
    return { changed: false, reason: 'Reverse persona changed or missing', sections }
  if (sections.some(row => row?.name === SECTION))
    return { changed: false, reason: 'guidance section already exists', sections }
  if (preset.mode === 'replace-persona') {
    return { changed: true, sections: sections.map((row, i) => i === n ? { ...row, text: preset.text } : row) }
  }
  if (preset.mode !== 'append') return { changed: false, reason: 'invalid mode', sections }
  const merged = sections.slice()
  merged.splice(n + 1, 0, { name: SECTION, text: preset.text })
  return { changed: true, sections: merged }
}
