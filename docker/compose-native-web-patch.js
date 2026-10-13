#!/usr/bin/env node
'use strict'
// DSH Web's CLI accepts a single --patch file. Compose image-owned plugins
// into one native DSH patch list without touching pnpm, Web Profile deps or
// DSH's official module loader.
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.DSH_NATIVE_PLUGIN_ROOT || '/opt/dsh/plugins'
const out = process.env.DSH_NATIVE_PATCH_OUTPUT || '/run/dsh/native-web.patch.yml'
const bind = process.env.DSH_BIND_PATCH || '/opt/dsh/dsh-bind.patch.yml'
const items = [
  ['dsh-reasoning-editor', 'DSH_REASONING_EDITOR', true],
  ['dsh-icon-dock', 'DSH_ICON_DOCK_ENABLED', true],
  ['dsh-session-manager-web', 'DSH_SESSION_MANAGER_WEB', true],
  ['dsh-web-search', 'DSH_SEARCH_ENABLED', false],
]

function enabled(flag, fallback) {
  const value = (process.env[flag] ?? String(fallback)).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true
  if (['0', 'false', 'no', 'off', 'disabled'].includes(value)) return false
  throw new Error('invalid ' + flag + ' value: ' + value)
}

function readChecked(file) {
  const contents = fs.readFileSync(file, 'utf8')
  if (!/^\s*(?:#[^\n]*\n|\s)*- (?:id:|insert:)/m.test(contents)) {
    throw new Error('expected a DSH patch array in ' + file)
  }
  return contents.trimEnd() + '\n'
}

function compose() {
  const parts = [readChecked(bind)]
  const selected = []
  for (const [name, flag, fallback] of items) {
    if (!enabled(flag, fallback)) continue
    const dir = path.join(root, name)
    const patchPath = path.join(dir, 'cordis.patch.yml')
    const source = readChecked(patchPath)
    // Each built-in has an exact local index.js entry. Resolve it to the
    // immutable image path when consolidating independent patch sources.
    const matches = [...source.matchAll(/^([ \t]*name:[ \t]*)\.\/index\.js[ \t]*$/gm)]
    if (matches.length !== 1) throw new Error('expected one bundled index in ' + patchPath)
    const filename = path.join(dir, 'index.js')
    if (!fs.existsSync(filename)) throw new Error('missing bundled module: ' + filename)
    parts.push(source.replace(/^([ \t]*name:[ \t]*)\.\/index\.js[ \t]*$/gm,
      (_match, prefix) => prefix + filename))
    selected.push(name)
  }
  const dir = path.dirname(out)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = path.join(dir, '.' + path.basename(out) + '-' + process.pid)
  try {
    fs.writeFileSync(temp, '# DSH Docker consolidated native Web patch; generated at startup\n' +
      parts.join('\n'), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, out)
  } finally {
    try { fs.unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  process.stderr.write('dsh-native-web: single launcher patch ready (' +
    selected.join(', ') + ')\n')
  process.stdout.write(out + '\n')
}
try { compose() }
catch (error) {
  process.stderr.write('dsh-native-web: ' + String(error.message) + '\n')
  process.exitCode = 1
}
