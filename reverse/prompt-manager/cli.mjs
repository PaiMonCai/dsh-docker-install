#!/usr/bin/env node
/** Reverse-only local Prompt Manager CLI. No HTTP admin endpoint. */
import { readFileSync, statSync } from 'node:fs'
import {
  readState, readActive, writeState, loadPreset, listPresets, importPreset,
  removePreset, fingerprint, applyPreset, LIMIT, saveSectionPreset,
  listVersions, restoreVersion
} from './core.mjs'
import { requestCapture, clearCapture, getSnapshot } from './inspect.mjs'
const say = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
function usage() {
  process.stdout.write([
    'reverse-prompt status | list | show NAME | activate NAME | disable',
    'reverse-prompt import NAME FILE [--replace-persona] | remove NAME',
    'reverse-prompt preview [NAME] | preview-live [NAME] | inspect | doctor | capture-next | capture-show | capture-clear',
    'reverse-prompt section-set NAME SECTION FILE [AFTER] | section-remove NAME SECTION',
    'reverse-prompt section-list NAME | history NAME | rollback NAME REVISION',
  ].join('\n') + '\n')
}
function textFile(file) {
  if (!file) throw Error('text file required')
  if (file !== '-' && statSync(file).size > LIMIT) throw Error('prompt file exceeds 12 KiB')
  const value = readFileSync(file === '-' ? 0 : file, 'utf8')
  if (Buffer.byteLength(value) > LIMIT) throw Error('prompt file exceeds 12 KiB')
  return value
}
function editable(name) {
  try { return loadPreset(name) }
  catch (error) {
    if (String(error.message).startsWith('unknown prompt preset:'))
      return { mode: 'sections', rules: [], title: name }
    throw error
  }
}
try {
  const [cmd, a, b, c] = process.argv.slice(2)
  let state, stateError = null
  try { state = readState() } catch (err) { stateError = String(err?.message ?? err); if (cmd !== 'doctor') throw err }
  switch (cmd) {
    case 'status': {
      const current = readActive()
      say({ ...current.state, preset: current.preset && {
        name: current.preset.name, title: current.preset.title,
        mode: current.preset.mode, fingerprint: fingerprint(current.preset)
      } })
      break
    }
    case 'list': say(listPresets().map(id => {
      const p = loadPreset(id)
      return { name: id, title: p.title, mode: p.mode,
        active: state.enabled && state.active === id, fingerprint: fingerprint(p) }
    })); break
    case 'show': say(loadPreset(a)); break
    case 'activate': loadPreset(a); say(writeState({ schema: 1, enabled: true, active: a })); break
    case 'disable': say(writeState({ ...state, enabled: false })); break
    case 'import': {
      if (c && c !== '--replace-persona') throw Error('unknown import option')
      const p = importPreset(a, textFile(b), undefined, c ? 'replace-persona' : 'append')
      say({ name: p.name, mode: p.mode, fingerprint: fingerprint(p) })
      break
    }
    case 'remove': removePreset(a); say({ removed: a }); break
    case 'preview': {
      const p = loadPreset(a || state.active)
      const baseline = [
        { name: 'deployment:persona-prefix', text: 'You are Reverse Engineer — offline placeholder.' },
        { name: 'tool:protocol', text: '[preserved original tool definitions]' },
      ]
      const result = applyPreset(baseline, p)
      say({ note: 'OFFLINE mock sections only, not a live model request.',
        preset: p.name, fingerprint: fingerprint(p), changed: result.changed,
        reason: result.reason, sections: result.sections })
      break
    }
    case 'inspect': say(getSnapshot()); break
    case 'preview-live': {
      const captured = getSnapshot(undefined, true)
      if (!captured.available) throw Error(captured.note)
      const p = loadPreset(a || state.active)
      const result = applyPreset(captured.pristineSections, p)
      say({ note: 'Applied to actual previously captured pre-render sections. NOT a future request or final model input.',
        capturedAt: captured.capturedAt, preset: p.name, fingerprint: fingerprint(p),
        changed: result.changed, reason: result.reason, sections: result.sections })
      break
    }
    case 'doctor': {
      let active = null, error = null
      try { active = readActive().preset } catch (e) { error = String(e?.message ?? e) }
      let snapshot
      try { snapshot = getSnapshot() } catch (err) { error = String(err?.message ?? err); snapshot = { available: false } }
      if (stateError) error = stateError
      say({ healthy: error === null && (!snapshot.available || !snapshot.enabled || snapshot.injected),
        enabled: state?.enabled ?? false, active: active?.name ?? null, error,
        latestAssembly: snapshot.available ? {
          timestamp: snapshot.capturedAt, injected: snapshot.injected,
          reason: snapshot.reason, beforeSections: snapshot.before?.length,
          afterSections: snapshot.after?.length
        } : null,
        note: snapshot.available ? 'Diagnosis based on the last Reverse Agent assembly.'
          : 'Run a Reverse Agent request before checking live injection.' })
      break
    }
    case 'capture-next': say(requestCapture()); break
    case 'capture-show': say(getSnapshot(undefined, true)); break
    case 'capture-clear': say(clearCapture()); break
    case 'section-list': {
      const p = loadPreset(a)
      say({ preset: p.name, mode: p.mode, rules: p.mode === 'sections' ? p.rules : null })
      break
    }
    case 'section-set': {
      if (!a || !b) throw Error('section-set requires preset and section')
      const previous = editable(a)
      if (previous.mode !== 'sections') throw Error('preset is not a section-rule preset')
      const text = textFile(c)
      const rules = previous.rules.filter(r => r.section !== b)
      if (b === 'deployment:persona-prefix') {
        rules.push({ action: 'replace', section: b, text })
      } else {
        rules.push({ action: 'insert-after', section: b,
          after: process.argv[6] ?? 'deployment:persona-prefix', text })
      }
      const p = saveSectionPreset(a, rules, undefined, previous.title)
      say({ preset: p.name, fingerprint: fingerprint(p), rules: p.rules.length })
      break
    }
    case 'section-remove': {
      const current = loadPreset(a)
      if (current.mode !== 'sections') throw Error('preset is not a section-rule preset')
      const rules = current.rules.filter(r => r.section !== b)
      if (rules.length === current.rules.length) throw Error('unknown section rule')
      if (rules.length < 1) throw Error('cannot empty preset; remove the preset instead')
      const p = saveSectionPreset(a, rules, undefined, current.title)
      say({ preset: p.name, rules: p.rules.length })
      break
    }
    case 'history': say({ preset: a, versions: listVersions(a) }); break
    case 'rollback': {
      if (!b) throw Error('revision required')
      const p = restoreVersion(a, b)
      say({ preset: p.name, mode: p.mode, fingerprint: fingerprint(p) })
      break
    }
    default: usage(); if (cmd) process.exitCode = 2
  }
} catch (error) {
  process.stderr.write('reverse-prompt: ' + String(error?.message ?? error) + '\n')
  process.exitCode = 1
}
