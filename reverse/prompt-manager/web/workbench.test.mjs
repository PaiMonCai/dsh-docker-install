import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const home=mkdtempSync(join(tmpdir(),'reverse-workbench-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
const {tasks,taskDetail,report,manifest}=await import('./workbench.mjs')
test('read-only evidence and task metadata',()=>{
 const folder=join(home,'.reverse-tasks')
 mkdirSync(folder)
 const id='3b8e0c0a-7360-4c43-8d92-f05e06ad77f7'
 writeFileSync(join(folder,id+'.json'),JSON.stringify({
   schema:'dsh-reverse-task/v1',id,kind:'triage',state:'succeeded',
   attempts:1,created_at:'2026-01-01',updated_at:'2026-01-01',
   result:{exit_code:0,stdout:'a secret output'}
 }))
 assert.equal(tasks().length,1)
 assert.equal(taskDetail(id).state,'succeeded')
 assert.ok(!JSON.stringify(taskDetail(id)).includes('secret'))
 writeFileSync(join(home,'functions.json'),JSON.stringify({
  schema:'dsh-reverse-ghidra/v2',program:'test',functions:[{
    address:'0x100',name:'main',signature:'void main()',pseudocode:'return;'
  }],call_graph:{nodes:[{address:'0x100',name:'main'}],edges:[]}
 }))
 assert.equal(report('functions.json').functions[0].name,'main')
})
test('reject traversal, absolute files and symlink targets',()=>{
 assert.throws(()=>report('../outside.json'))
 assert.throws(()=>report('/etc/passwd'))
 symlinkSync('/etc/passwd',join(home,'shortcut.json'))
 assert.throws(()=>report('shortcut.json'))
 assert.throws(()=>taskDetail('../../etc/passwd'))
})
test.after(()=>rmSync(home,{force:true,recursive:true}))

test('graph viewer filters non-exported edges and maps real entrypoint references',()=>{
 writeFileSync(join(home,'xref.json'),JSON.stringify({
  schema:'dsh-reverse-ghidra/v2',program:'sample',
  functions:[{address:'0x1',name:'entry',signature:'void()',pseudocode:'call();'}],
  call_graph:{nodes:[{address:'0x1',name:'entry'}],
    edges:[{source:'0x1',target:'0x999'},{source:'0x1',target:'0x1'}]},
  references:{entries:[{target:'0x1',from:'0x88',type:'READ'},
    {target:'0x999',from:'0x77',type:'CALL'}]}
 }))
 const data=report('xref.json')
 assert.equal(data.edges.length,1)
 assert.equal(data.references.length,1)
 assert.deepEqual(data.references[0],{target:'0x1',from:'0x88',type:'READ'})
})

test('evidence index navigation verifies SHA-256, size and schema',()=>{
 const evidence={schema:'dsh-reverse-evidence/v1',sample:{},evidence:[]}
 const raw=JSON.stringify(evidence)
 writeFileSync(join(home,'evidence.json'),raw)
 const hash=createHash('sha256').update(raw).digest('hex')
 const path='index.json'
 writeFileSync(join(home,path),JSON.stringify({
   schema:'dsh-reverse-workspace/v1',reports:[
     {path:'evidence.json',schema:evidence.schema,sha256:hash,size:Buffer.byteLength(raw)},
     {path:'missing.json',schema:evidence.schema,sha256:hash,size:1}
   ]
 }))
 const first=manifest(path)
 assert.equal(first.total,2)
 assert.equal(first.verified,1)
 assert.equal(first.reports[0].verified,true)
 assert.equal(first.reports[1].verified,false)
 writeFileSync(join(home,'evidence.json'),raw+' ')
 assert.equal(manifest(path).verified,0)
})
