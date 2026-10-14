#!/usr/bin/env node
/** Native Reverse prompt manager CLI; no Web auth surface. */
import { readFileSync } from 'node:fs'
import { readState, readActive, writeState, loadPreset, listPresets, importPreset, removePreset, fingerprint, applyPreset } from './core.mjs'
const say = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
function usage() { process.stdout.write('reverse-prompt status | list | show NAME | activate NAME | disable | import NAME FILE [--replace-persona] | remove NAME | preview [NAME]\n') }
try {
  const [cmd, name, file, option] = process.argv.slice(2)
  const state = readState()
  switch (cmd) {
    case 'status': {
      const { state, preset } = readActive()
      say({ ...state, preset: preset && { name: preset.name, title: preset.title, mode: preset.mode, fingerprint: fingerprint(preset) } })
      break
    }
    case 'list': say(listPresets().map(id => {
      const p = loadPreset(id)
      return { name: id, title: p.title, mode: p.mode, active: id === state.active && state.enabled, fingerprint: fingerprint(p) }
    })); break
    case 'show': say(loadPreset(name)); break
    case 'activate': loadPreset(name); say(writeState({ schema: 1, enabled: true, active: name })); break
    case 'disable': say(writeState({ ...state, enabled: false })); break
    case 'import': {
      if (!name || !file) throw Error('import requires preset name and file (or - for stdin)')
      if (option && option !== '--replace-persona') throw Error('unknown option')
      const text = readFileSync(file === '-' ? 0 : file, 'utf8')
      const p = importPreset(name, text, undefined, option ? 'replace-persona' : 'append')
      say({ name: p.name, mode: p.mode, fingerprint: fingerprint(p) })
      break
    }
    case 'remove': removePreset(name); say({ removed: name }); break
    case 'preview': {
      const p = loadPreset(name || state.active)
      const sections = [
        { name: 'deployment:persona-prefix', text: 'You are Reverse Engineer — preview placeholder, not a live prompt.' },
        { name: 'tool:protocol', text: '[unchanged DSH tool definitions]' },
      ]
      const result = applyPreset(sections, p)
      say({ note: 'Preview of custom change ONLY; not the entire live DSH system prompt.',
        preset: p.name, fingerprint: fingerprint(p), mode: p.mode,
        changed: result.changed, reason: result.reason, sections: result.sections })
      break
    }
    default: usage(); if (cmd) process.exitCode = 2
  }
} catch (error) {
  process.stderr.write('reverse-prompt: ' + String(error?.message ?? error) + '\n')
  process.exitCode = 1
}
