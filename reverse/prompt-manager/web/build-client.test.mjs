import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARTS,assemble,check } from './build-client.mjs'
const base=dirname(fileURLToPath(import.meta.url))
test('modular Web client matches native production bundle exactly',()=>{
  assert.equal(check(),true)
  const body=assemble()
  assert.equal(body,readFileSync(join(base,'client.js'),'utf8'))
  assert.equal(PARTS.length,6)
  assert.ok(body.startsWith('/* Native DSH Client module'))
  assert.ok(body.includes("id:'reverse-workbench'"))
  assert.ok(body.includes("id:'reverse-prompt-manager'"))
})
test('UI modules are distinct, with one browser entry point',()=>{
  for(const name of ['10-ui-primitives.js','20-prompt-settings.js',
    '30-case-graph.js','40-workbench.js']){
    const body=readFileSync(join(base,'src',name),'utf8')
    assert.ok(body.startsWith('    function '))
    assert.ok(body.length>800)
  }
  const runtime=assemble()
  assert.equal(runtime.split('window.__ModuleLoader__.load(').length-1,1)
  assert.equal(runtime.split("ctx.slots.inject('settings.section'").length-1,2)
})
