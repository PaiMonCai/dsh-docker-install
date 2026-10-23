#!/usr/bin/env node
// Compose ordering gates without mounting Agents or evaluating !!js expressions.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSettings } from './plugins/dsh-context-manager/storage.mjs'
import { nativeOrderingPatches, externalContextPluginPresent } from './plugins/dsh-context-manager/native-plugin.mjs'

try {
  const saved = readSettings()
  if (!saved.nativePlugin.enabled || process.env.DSH_CONTEXT_MANAGER_NATIVE_ACTIVE === '0'
    || /^(0|false|no|off|disabled)$/i.test(process.env.DSH_CONTEXT_MANAGER_PROBE ?? '')
    || process.env.DSH_CONTEXT_MANAGER_TIERED_ACTIVE === '1') process.exit(0)
  if (externalContextPluginPresent()) throw Error('external context plugin detected')
  const rq = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json')
  const yaml = rq('js-yaml')
  const expression = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar', construct: text => ({ nativeUnevaluatedExpression: text }),
  })
  const dump = spawnSync('dsh', [...process.argv.slice(2), '--dump-config'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  })
  if (dump.status !== 0) throw Error('native config dump unavailable')
  const tree = yaml.load(dump.stdout, { schema: yaml.JSON_SCHEMA.extend(expression) })
  const patches = nativeOrderingPatches(tree)
  if (!patches.length) throw Error('no native Agent presets found')
  const file = join(mkdtempSync(join(tmpdir(), 'dsh-context-native-')), 'ordering.json')
  writeFileSync(file, JSON.stringify(patches), { mode: 0o600 })
  process.stdout.write(file)
} catch {
  process.stderr.write('dsh-entrypoint: native context plugin could not prepare compatible startup; preserving native DSH\n')
  process.exitCode = 1
}
