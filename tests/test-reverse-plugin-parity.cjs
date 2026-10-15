'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { snapshot, compare, declaredPatches } = require('../ci/reverse-web-parity.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-parity-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  const pluginRoot = path.join(root, 'plugins')
  fs.mkdirSync(pluginRoot)
  const launcher = path.join(root, 'entrypoint.sh')
  function add(directory, setting = 'DSH_WIDGET_ENABLED', defaultEnabled = 'true') {
    const base = path.join(pluginRoot, directory)
    fs.mkdirSync(base)
    const id = 'dsh-docker-' + directory
    fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({
      name: id, dsh: { client: { platform: 'web' }, bundle: { patch: './cordis.patch.yml' } },
    }))
    for (const file of ['index.js', 'client.js', 'cordis.patch.yml']) {
      fs.writeFileSync(path.join(base, file), '// ' + directory + '/' + file + '\n')
    }
    const line = 'append_native_web_patch "/opt/dsh/plugins/' + directory +
      '/cordis.patch.yml" "' + '$' + '{' + setting + ':-' + defaultEnabled + '}" "UI"\n'
    fs.appendFileSync(launcher, line)
  }
  return { root, pluginRoot, launcher, add, take: () => snapshot(pluginRoot, launcher) }
}

test('dynamic discovery detects new Standard Web plugins without editing a hardcoded list', t => {
  const f = fixture(t)
  f.add('alpha', 'DSH_ALPHA_ENABLED')
  f.add('brand-new-plugin', 'DSH_BRAND_NEW_ENABLED', 'false')
  const expected = f.take()
  assert.deepEqual(expected.plugins.map(p => p.directory), ['alpha', 'brand-new-plugin'])
  assert.deepEqual(expected.overlays.map(o => o.setting), ['DSH_ALPHA_ENABLED', 'DSH_BRAND_NEW_ENABLED'])
  const actual = f.take()
  compare(expected, actual)
})

test('missing, renamed or tampered inherited plugin fails closed', t => {
  const f = fixture(t)
  f.add('alpha')
  const before = f.take()
  fs.writeFileSync(path.join(f.pluginRoot, 'alpha/client.js'), 'modified plugin code')
  assert.throws(() => compare(before, f.take()), /changed inherited Standard plugin files/)
  fs.rmSync(path.join(f.pluginRoot, 'alpha'), { recursive: true })
  assert.throws(() => f.take(), /launcher references missing Web plugin/)
})

test('an unregistered future Web plugin is not silently ignored', t => {
  const f = fixture(t)
  f.add('alpha')
  f.add('new-plugin', 'DSH_NEW_ENABLED')
  fs.writeFileSync(f.launcher,
    'append_native_web_patch "/opt/dsh/plugins/alpha/cordis.patch.yml" "' +
    '$' + '{DSH_WIDGET_ENABLED:-true}" "UI"\n')
  assert.throws(() => f.take(), /Web plugin not registered in Standard launcher: dsh-docker-new-plugin/)
})

test('dynamic launcher parser rejects unsupported switches and duplicate patches', () => {
  const patch = '/opt/dsh/plugins/alpha/cordis.patch.yml'
  assert.throws(() => declaredPatches('append_native_web_patch "' + patch + '" "$UNKNOWN" "UI"'),
    /no native Web plugins/)
  const item = 'append_native_web_patch "' + patch + '" "true" "UI"\n'
  assert.throws(() => declaredPatches(item + item), /duplicate native Web patch declaration/)
})
