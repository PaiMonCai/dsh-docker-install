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
  'dsh-docker-session-manager',
  'dsh-docker-web-search',
])

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
    const removed = migrate(process.env.DSH_HOME || '/root/.dsh')
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
module.exports = { migrate, BUILT_INS }
