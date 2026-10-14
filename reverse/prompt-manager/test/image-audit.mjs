/** Run inside a built Reverse image; avoids fragile nested shell evaluation quoting. */
import assert from 'node:assert/strict'
import { listPresets, loadPreset, readState, applyPreset } from '../core.mjs'
import { getSnapshot } from '../inspect.mjs'
const names = listPresets()
for (const name of ['evidence', 'concise', 'architecture']) assert.ok(names.includes(name), name)
assert.equal(readState().enabled, false)
const base = [
  { name: 'deployment:persona-prefix', text: 'You are Reverse Engineer.' },
  { name: 'tool:protocol', text: 'untouched' },
]
const enhanced = applyPreset(base, loadPreset('evidence'))
assert.equal(enhanced.changed, true)
assert.equal(enhanced.sections[2], base[1])
assert.equal(getSnapshot().available, false)
console.log('Reverse Prompt Manager image audit passed')
