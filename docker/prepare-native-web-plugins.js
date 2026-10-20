#!/usr/bin/env node
'use strict'
// One-time, reversible retirement of historical image-bundled Web plugins
// from the profile's pnpm-managed bundle SELECTION. Their new runtime loads
// through the image's DSH launcher patch layers instead of a third-party
// profile installation. Keep dependencies, lockfiles and third-party rows.
const fs = require('node:fs')
const path = require('node:path')

const BUILT_INS = new Set([
  'dsh-docker-reasoning-editor',
  'dsh-docker-icon-dock',
  'dsh-docker-instance-manager',
  'dsh-docker-session-manager',
  'dsh-docker-web-search',
])

// One-time rollback for images released with the retired billion UI Bridge.
// Only restore the exact third-party browser file when *our* marker is present
// and the original on-disk backup is intact. Never uninstall the third-party
// package, rewrite its settings, or follow a symlink out of DSH_HOME.
const LEGACY_BRIDGE_MARKER = 'DSH_BILI_SAME_ORIGIN_UI'
function restoreRetiredBridge(home) {
  const root = fs.realpathSync(home)
  const packagePath = path.join(root, 'profiles', 'web', 'node_modules', 'billion-context')
  if (!fs.existsSync(packagePath)) return 'not-installed'
  const packageRoot = fs.realpathSync(packagePath)
  if (!packageRoot.startsWith(root + path.sep)) {
    throw Error('legacy UI package escapes DSH_HOME; refusing rollback')
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.name !== 'billion-context') return 'not-a-matching-package'
  const file = path.join(packageRoot, 'dist', 'agent', 'dsh-native-client.js')
  if (!fs.existsSync(file)) return 'client-missing'
  const clientInfo = fs.lstatSync(file)
  if (!clientInfo.isFile() || clientInfo.isSymbolicLink() || clientInfo.size > 2 * 1024 * 1024) {
    throw Error('unsafe legacy UI client')
  }
  const modified = fs.readFileSync(file, 'utf8')
  if (!modified.includes(LEGACY_BRIDGE_MARKER)) return 'already-clean'
  const backup = file + '.dsh-original-before-domain-bridge'
  if (!fs.existsSync(backup)) {
    throw Error('patched legacy UI client has no original backup; leaving it untouched')
  }
  const originalInfo = fs.lstatSync(backup)
  if (!originalInfo.isFile() || originalInfo.isSymbolicLink() || originalInfo.size > 2 * 1024 * 1024) {
    throw Error('unsafe legacy UI backup; leaving modified file untouched')
  }
  const original = fs.readFileSync(backup, 'utf8')
  if (original.includes(LEGACY_BRIDGE_MARKER) ||
      !original.includes('window.__ModuleLoader__') ||
      !original.includes('billion-context')) {
    throw Error('legacy UI backup cannot be validated; leaving modified file untouched')
  }
  const temporary = path.join(path.dirname(file), '.dsh-client-bridge-retirement-' + process.pid)
  try {
    fs.writeFileSync(temporary, original, {
      mode: clientInfo.mode & 0o777, flag: 'wx',
    })
    fs.renameSync(temporary, file)
  } finally {
    try { fs.unlinkSync(temporary) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  // Retain backup as the user's recovery artifact.
  return 'original-restored'
}

function migrate(home) {
  const profile = path.join(home, 'profiles', 'web')
  const manifest = path.join(profile, 'package.json')
  if (!fs.existsSync(manifest)) {
    process.stderr.write('dsh-native-web: no persisted Web Profile to migrate\n')
    return []
  }
  const stat = fs.statSync(manifest)
  const original = fs.readFileSync(manifest, 'utf8')
  const config = JSON.parse(original)
  const selected = config.dsh?.profile?.bundles
  if (selected === undefined) return []
  if (!Array.isArray(selected) || selected.some(v => typeof v !== 'string')) {
    throw new Error('Web Profile has a malformed dsh.profile.bundles field')
  }
  const removed = selected.filter(name => BUILT_INS.has(name))
  if (!removed.length) return []
  // Retain the original file verbatim for manual rollback and never touch
  // pnpm-lock.yaml, node_modules or unrelated profile dependencies.
  const backup = path.join(profile, 'package.json.before-native-web-plugins')
  if (!fs.existsSync(backup)) {
    fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' })
  }
  config.dsh.profile.bundles = selected.filter(name => !BUILT_INS.has(name))
  const updated = JSON.stringify(config, null, 2) + '\n'
  const temporary = path.join(profile, '.package.json.native-' + process.pid)
  try {
    fs.writeFileSync(temporary, updated, { mode: stat.mode & 0o777, flag: 'wx' })
    fs.renameSync(temporary, manifest)
  } finally {
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return removed
}

if (require.main === module) {
  try {
    const home = process.env.DSH_HOME || '/root/.dsh'
    // A bridge removal must not break the DSH Web launcher if the user's
    // third-party files or backup are already damaged. Record the warning.
    try {
      const state = restoreRetiredBridge(home)
      if (state === 'original-restored') {
        process.stderr.write('dsh-native-web: restored third-party UI client from retired bridge backup\n')
      }
    } catch (error) {
      process.stderr.write('dsh-native-web: legacy UI rollback warning: ' + error.message + '\n')
    }
    const removed = migrate(home)
    if (removed.length) {
      process.stderr.write('dsh-native-web: retired legacy profile bundle selections: ' +
        removed.join(', ') + '\n')
      process.stderr.write('dsh-native-web: original manifest backed up; plugin files now load from immutable image paths\n')
    }
  } catch (error) {
    process.stderr.write('dsh-native-web: migration failed: ' + error.message + '\n')
    process.exitCode = 1
  }
}
module.exports = { migrate, BUILT_INS, restoreRetiredBridge }
