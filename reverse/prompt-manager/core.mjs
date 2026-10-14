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
      !p.title.trim() || Buffer.byteLength(p.title) > 120) {
    throw Error('invalid prompt preset: ' + name)
  }
  if (p.mode === 'sections') {
    const rules = validateRules(p.rules)
    return { schema: 1, name, title: p.title.trim(), mode: 'sections', rules }
  }
  if (!['append', 'replace-persona'].includes(p.mode) ||
      typeof p.text !== 'string' || !p.text.trim() || Buffer.byteLength(p.text) > LIMIT)
    throw Error('invalid prompt preset: ' + name)
  if (/{{[^{}]*}}/.test(p.text)) throw Error('DSH {{variable}} syntax is not supported in custom prompts')
  return { schema: 1, name, title: p.title.trim(), mode: p.mode, text: p.text }
}
/** Rules are limited to Reverse-owned sections and its Persona.
 * Tool schemas, host identity, approval policies and other sections are immutable.
 */
export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 8)
    throw Error('section preset must contain 1..8 rules')
  const names = new Set()
  const validated = []
  for (const rule of rules) {
    if (!rule || !['insert-after', 'replace'].includes(rule.action) ||
        typeof rule.text !== 'string' || !rule.text.trim() ||
        Buffer.byteLength(rule.text) > LIMIT || /{{[^{}]*}}/.test(rule.text))
      throw Error('invalid section rule')
    if (rule.action === 'replace') {
      if (rule.section !== 'deployment:persona-prefix')
        throw Error('only the Reverse persona is replaceable')
      if (names.has(rule.section)) throw Error('duplicate section rule')
      names.add(rule.section)
      validated.push({ action: 'replace', section: rule.section, text: rule.text })
      continue
    }
    if (typeof rule.section !== 'string' ||
        !/^reverse:user-[a-z][a-z0-9-]{0,39}$/.test(rule.section) ||
        names.has(rule.section) ||
        !(rule.after === 'deployment:persona-prefix' || names.has(rule.after)))
      throw Error('insert requires a unique reverse:user-* section and an existing approved anchor')
    names.add(rule.section)
    validated.push({ action: 'insert-after', section: rule.section, after: rule.after, text: rule.text })
  }
  if (Buffer.byteLength(JSON.stringify(validated)) > LIMIT)
    throw Error('section rules exceed maximum combined size')
  return validated
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
export function atomic(path, contents) {
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
  return createHash('sha256').update(p.mode + '\n' + (p.mode === 'sections' ? JSON.stringify(p.rules) : p.text)).digest('hex').slice(0, 16)
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
  if (preset.mode === 'sections') {
    const rules = validateRules(preset.rules)
    let applied = sections.slice()
    for (const rule of rules) {
      if (rule.action === 'replace') {
        const idx = applied.findIndex(row => row.name === 'deployment:persona-prefix')
        applied = applied.map((row, i) => i === idx ? { ...row, text: rule.text } : row)
        continue
      }
      const idx = applied.findIndex(row => row.name === rule.after)
      if (idx < 0 || applied.some(row => row.name === rule.section))
        return { changed: false, reason: 'section anchor missing or duplicate', sections }
      applied.splice(idx + 1, 0, { name: rule.section, text: rule.text, interpolate: false })
    }
    return { changed: true, sections: applied }
  }
  if (preset.mode === 'replace-persona') {
    return { changed: true, sections: sections.map((row, i) => i === n ? { ...row, text: preset.text } : row) }
  }
  if (preset.mode !== 'append') return { changed: false, reason: 'invalid mode', sections }
  const merged = sections.slice()
  merged.splice(n + 1, 0, { name: SECTION, text: preset.text })
  return { changed: true, sections: merged }
}


/** Only user-owned presets can be edited; snapshot previous versions privately. */
export function saveSectionPreset(name, rules, home, title = name) {
  name = slug(name)
  if (existsSync(builtIn(name))) throw Error('built-in presets are read-only')
  const preset = normalizePreset({ schema: 1, name, title, mode: 'sections', rules }, name)
  const path = userFile(name, home)
  const previous = readSmall(path)
  if (previous !== undefined) {
    const backup = join(root(home), 'history', name, String(Date.now()) + '-' + randomUUID() + '.json')
    atomic(backup, JSON.stringify(previous, null, 2) + '\n')
    const versions = listVersions(name, home)
    for (const stale of versions.slice(8)) unlinkSync(join(root(home), 'history', name, stale))
  }
  atomic(path, JSON.stringify(preset, null, 2) + '\n')
  return preset
}
export function listVersions(name, home) {
  name = slug(name)
  const folder = join(root(home), 'history', name)
  if (!existsSync(folder)) return []
  if (!lstatSync(folder).isDirectory()) throw Error('invalid prompt history directory')
  return readdirSync(folder)
    .filter(entry => /^\d{13}-[0-9a-f-]{36}\.json$/.test(entry))
    .sort().reverse()
}
export function restoreVersion(name, revision, home) {
  name = slug(name)
  if (typeof revision !== 'string' || !/^\d{13}-[0-9a-f-]{36}\.json$/.test(revision))
    throw Error('invalid revision id')
  const path = join(root(home), 'history', name, revision)
  const previous = readSmall(path)
  if (!previous) throw Error('revision does not exist')
  const verified = normalizePreset(previous, name)
  return saveSectionPreset(name, verified.rules ?? [{
    action: verified.mode === 'replace-persona' ? 'replace' : 'insert-after',
    section: verified.mode === 'replace-persona' ? 'deployment:persona-prefix' : 'reverse:user-restored',
    ...(verified.mode === 'replace-persona' ? {} : { after: 'deployment:persona-prefix' }),
    text: verified.text
  }], home, verified.title)
}
