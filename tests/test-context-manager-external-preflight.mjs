/**
 * Docker-only security regression. Refuse Tiered owner when an external bili
 * package is installed even if the operator set optimistic assertions.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaults } from '/opt/dsh/plugins/dsh-context-manager/policy.mjs'
import { readSettings, writeSettings, settingsRevision } from '/opt/dsh/plugins/dsh-context-manager/storage.mjs'
const home=mkdtempSync(join(tmpdir(),'dsh-bili-conflict-'))
const env={...process.env,DSH_HOME:home,DSH_CONTEXT_MANAGER_TIERED_ACTIVE:'1',
  DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED:'1',DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY:'1'}
function preflight(){
  return spawnSync(process.execPath,['/opt/dsh/context-manager-tiered-preflight.mjs'],{
    env,encoding:'utf8',timeout:15000,
  })
}
try {
  process.env.DSH_HOME=home
  const config=defaults();config.engine='tiered'
  writeSettings(config,settingsRevision(readSettings()))
  const clean=preflight()
  assert.equal(clean.status,0,clean.stderr)
  assert.match(clean.stdout,/PREFLIGHT_ALLOWED/)
  const path=join(home,'profiles','third-party-bili')
  mkdirSync(path,{recursive:true})
  writeFileSync(join(path,'package.json'),JSON.stringify({
    name:'user-profile',
    dependencies:{'billion-context':'0.1.202'},
  }))
  const blocked=preflight()
  assert.notEqual(blocked.status,0)
  assert.match(blocked.stderr,/PREFLIGHT_DENIED/)
  assert.match(blocked.stderr,/billion-context/)
  process.stdout.write('DSH_CONTEXT_MANAGER_BILI_CONFLICT_GATE_PASS clean=allow present=deny\n')
} finally{
  rmSync(home,{recursive:true,force:true})
}
