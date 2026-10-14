import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { command } from './index.mjs'
const home=mkdtempSync(join(tmpdir(),'reverse-web-settings-'))
process.env.DSH_HOME=home
test('web commands default disabled and enumerate builtins',()=>{
  assert.equal(command('state').enabled,false)
  assert.ok(command('list').some(x=>x.name==='evidence'))
})
test('web accepts custom Reverse rule presets and preserves native protections',()=>{
  const rules=[{action:'insert-after',section:'reverse:user-context',
    after:'deployment:persona-prefix',text:'Check source and hashes'}]
  const saved=command('save',{name:'my-analysis',mode:'sections',rules})
  assert.equal(saved.mode,'sections')
  assert.equal(command('get',{name:'my-analysis'}).rules.length,1)
  assert.throws(()=>command('save',{name:'bad',mode:'sections',rules:[{
    action:'replace',section:'tools:protocol',text:'invalid'}]}))
  assert.equal(command('activate',{name:'my-analysis'}).enabled,true)
  assert.equal(command('disable').enabled,false)
})
test('web cannot mutate builtins or accept invalid methods',()=>{
  assert.throws(()=>command('save',{name:'evidence',mode:'append',text:'changed'}))
  assert.throws(()=>command('remove',{name:'evidence'}))
  assert.throws(()=>command('invalidMethod'))
})
test('inspection returns absent snapshot and one-shot capture request',()=>{
  assert.equal(command('inspect').available,false)
  assert.equal(command('captureShow').available,false)
  assert.equal(command('captureRequest').requested,true)
  assert.equal(command('captureClear').cleared,true)
})
test.after(()=>rmSync(home,{recursive:true,force:true}))
