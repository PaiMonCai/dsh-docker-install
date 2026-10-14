/**
 * Reverse-only live prompt diagnostics.
 *
 * Default snapshot: section names, lengths and SHA-256 hashes, no prompt text.
 * Full text is captured only after a local explicit one-shot request, for a
 * maximum five-minute window. Never records user messages or credentials
 * from the generic runtime/context fields.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomic, root } from './core.mjs'

const MAX_CAPTURE_BYTES = 512 * 1024
const TTL_MS = 5 * 60 * 1000
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex')

function fileAt(file, home) { return join(root(home), file) }
function maybeRead(name, home, max = MAX_CAPTURE_BYTES + 1024) {
  const path = fileAt(name, home)
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > max) throw Error('Invalid prompt diagnostic file')
  return JSON.parse(readFileSync(path, 'utf8'))
}
function erase(name, home) {
  const file = fileAt(name, home)
  if (existsSync(file)) {
    if (!lstatSync(file).isFile()) throw Error('Refusing to remove non-file diagnostic')
    unlinkSync(file)
  }
}
export function requestCapture(home) {
  const request = { schema: 1, id: randomUUID(), expiresAt: Date.now() + TTL_MS }
  atomic(fileAt('capture-request.json', home), JSON.stringify(request) + '\n')
  return { requested: true, expiresAt: request.expiresAt }
}
export function clearCapture(home) {
  erase('capture-request.json', home)
  erase('capture.json', home)
  return { cleared: true }
}
export function getSnapshot(home, full = false) {
  const item = maybeRead(full ? 'capture.json' : 'last-assembly.json', home)
  if (!item) return { available: false, note: full
    ? 'No explicit full capture has been collected. Run capture-next first.'
    : 'No Reverse Agent prompt has been assembled since this runtime started.' }
  if (full && item.schema !== 1) throw Error('Invalid capture version')
  return { available: true, ...item }
}
function summarize(sections) {
  return (Array.isArray(sections) ? sections : []).slice(0, 200).map((part, index) => {
    const text = typeof part?.text === 'string' ? part.text : ''
    return { index, name: typeof part?.name === 'string' ? part.name.slice(0, 180) : 'unknown',
      bytes: Buffer.byteLength(text), sha256: digest(text) }
  })
}
/** Called after an actual Reverse Agent prompt was assembled, never from a mock. */
export function recordAssembly(original, applied, details = {}, home) {
  const pristine = summarize(original?.sections)
  const sections = summarize(applied?.sections)
  const record = { schema: 1, capturedAt: Date.now(), agentPreset: 'reverse-engineering',
    preset: details.preset ?? null, enabled: Boolean(details.enabled),
    injected: Boolean(details.injected), reason: details.reason ?? null,
    before: pristine, after: sections,
    note: 'Real assembled section metadata; no section text or messages stored by default.' }
  atomic(fileAt('last-assembly.json', home), JSON.stringify(record) + '\n')
  let request
  try { request = maybeRead('capture-request.json', home, 2048) } catch { return record }
  if (!request || request.schema !== 1 || !Number.isSafeInteger(request.expiresAt)) return record
  if (Date.now() > request.expiresAt) { erase('capture-request.json', home); return record }
  // No tool definitions, messages, contexts or variable values are captured.
  // The actual DSH final render happens after the assembly hook.
  const raw = { schema: 1, capturedAt: record.capturedAt, agentPreset: 'reverse-engineering',
    preset: record.preset, enabled: record.enabled, injected: record.injected,
    pristineSections: (original?.sections ?? []).map(s => ({
      name: String(s.name), text: String(s.text), interpolate: s.interpolate !== false
    })),
    sections: (applied?.sections ?? []).map(s => ({
      name: String(s.name), text: String(s.text), interpolate: s.interpolate !== false
    })),
    note: 'Actual prompt sections after assembly hook; before template interpolation. NOT the final model request.' }
  const encoded = JSON.stringify(raw)
  if (Buffer.byteLength(encoded) <= MAX_CAPTURE_BYTES) atomic(fileAt('capture.json', home), encoded + '\n')
  // One shot. This also prevents the next session from silently overwriting it.
  erase('capture-request.json', home)
  return record
}
