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
test('knowledge RPC is read-only, bounded and preserves provenance',()=>{
  const rows=command('workbenchKnowledgeSearch',{query:'wasm',platform:'wasm'})
  assert.ok(rows.some(x=>x.id==='wasm-host-import'))
  assert.equal(command('workbenchKnowledgeEntry',{id:'wasm-host-import'}).confidence,'reference-only')
  assert.throws(()=>command('workbenchKnowledgeSearch',{query:'x'.repeat(400),platform:'all'}))
  assert.throws(()=>command('workbenchKnowledgeEntry',{id:'../../etc/passwd'}))
  assert.throws(()=>command('workbenchKnowledgePromote',{id:'unused'}))
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

test('Reverse Web RPC owns a separate channel and never intercepts upstream /api', async()=>{
  const { apply } = await import('./index.mjs')
  let channel, handler, intercepted = false
  apply({ inject(services, callback) {
    assert.deepEqual(services, ['connection'])
    callback({connection:{rpc:{
      handle(path, fn) { channel=path; handler=fn },
      intercept() { intercepted=true; throw Error('must not claim shared /api') }
    }}})
  }})
  assert.equal(channel, '/reverse-prompt')
  assert.equal(intercepted, false)
  assert.deepEqual(await handler('state', {}), { ok:true, value:command('state') })
  assert.equal((await handler('invalidMethod', {})).ok, false)
})

test('authenticated workbench command supports independent Hook configuration',()=>{
  const saved=command('hookSave',{enabled:true,text:'Prefer static analysis evidence'})
  assert.equal(saved.enabled,true)
  assert.equal(command('hookGet').text,'Prefer static analysis evidence')
  assert.throws(()=>command('hookSave',{enabled:true,text:''}))
  assert.equal(command('hookSave',{enabled:false,text:saved.text}).enabled,false)
})

test('execution policy RPC is read-only and describes only Web queue surface',()=>{
  const old=process.env.DSH_REVERSE_WEB_EXECUTION
  delete process.env.DSH_REVERSE_WEB_EXECUTION
  try {
    const p=command('workbenchExecutionPolicy')
    assert.equal(p.scope,'web-queue-only')
    assert.equal(p.web_execution_enabled,false)
    assert.equal(p.agent_direct_tools,'outside-this-policy')
    process.env.DSH_REVERSE_WEB_EXECUTION='1'
    assert.equal(command('workbenchExecutionPolicy').web_execution_enabled,true)
  }finally {
    if(old===undefined)delete process.env.DSH_REVERSE_WEB_EXECUTION
    else process.env.DSH_REVERSE_WEB_EXECUTION=old
  }
})
