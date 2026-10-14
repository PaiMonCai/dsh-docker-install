import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=mkdtempSync(join(tmpdir(),'reverse-workbench-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
const {tasks,taskDetail,report}=await import('./workbench.mjs')
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
