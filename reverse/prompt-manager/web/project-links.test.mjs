import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const home=mkdtempSync(join(tmpdir(),'reverse-project-links-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
const {createProject}=await import('./projects.mjs')
const {projectLinks,attachProjectItem}=await import('./project-links.mjs')
const p=createProject('Example')
test('sample, task and evidence links persist and validate against source',()=>{
 writeFileSync(join(home,'sample.elf'),'ELF placeholder')
 const uuid=randomUUID()
 mkdirSync(join(home,'.reverse-tasks'))
 writeFileSync(join(home,'.reverse-tasks',uuid+'.json'),JSON.stringify({
  schema:'dsh-reverse-task/v1',id:uuid,kind:'triage',state:'succeeded',
  attempts:1,created_at:'2026-01-01',updated_at:'2026-01-01'
 }))
 writeFileSync(join(home,'report.json'),JSON.stringify({
   schema:'dsh-reverse-ghidra/v2',functions:[],call_graph:{nodes:[],edges:[]}
 }))
 attachProjectItem(p.id,'sample','sample.elf')
 attachProjectItem(p.id,'task',uuid)
 attachProjectItem(p.id,'evidence','report.json')
 const records=projectLinks(p.id).entries
 assert.equal(records.length,3)
 assert.ok(records.every(x=>x.valid))
 attachProjectItem(p.id,'evidence','report.json')
 assert.equal(projectLinks(p.id).entries.length,3)
 writeFileSync(join(home,'sample.elf'),'changed')
 assert.equal(projectLinks(p.id).entries.find(x=>x.kind==='sample').valid,false)
})
test('project links reject unsafe paths, arbitrary formats and invalid task IDs',()=>{
 assert.throws(()=>attachProjectItem(p.id,'sample','../passwd'))
 assert.throws(()=>attachProjectItem(p.id,'task','invalid'))
 assert.throws(()=>attachProjectItem(p.id,'evidence','sample.elf'))
 assert.throws(()=>attachProjectItem(p.id,'shell','sample.elf'))
})
test('exclusive cross-process lock refuses overlapping project writes without overwriting',()=>{
 const lock=join(home,'.reverse-projects',p.id+'.links.lock')
 const before=projectLinks(p.id).entries.length
 mkdirSync(lock)
 assert.throws(()=>attachProjectItem(p.id,'sample','sample.elf'),/being updated/)
 assert.equal(projectLinks(p.id).entries.length,before)
 rmSync(lock,{recursive:true})
 attachProjectItem(p.id,'sample','sample.elf')
 assert.equal(projectLinks(p.id).entries.length,before)
})
test('lock is released after validation error',()=>{
 assert.throws(()=>attachProjectItem(p.id,'evidence','sample.elf'))
 assert.ok(!existsSync(join(home,'.reverse-projects',p.id+'.links.lock')))
})
test.after(()=>rmSync(home,{recursive:true,force:true}))

test('project can link and validate a durable case without duplicating its ledger',()=>{
 const caseId=randomUUID()
 mkdirSync(join(home,'.reverse-cases'),{recursive:true})
 writeFileSync(join(home,'.reverse-cases',caseId+'.json'),JSON.stringify({
   schema:'dsh-reverse-case/v1',id:caseId,revision:1,goal:'Explain init',
   deliverable:'report',gates:{G1:{state:'passed'}},
   evidence:[],hypotheses:[],experiments:[],tasks:[],target:{path:'sample.elf',sha256:'a'.repeat(64)}
 }))
 attachProjectItem(p.id,'case',caseId)
 const linked=projectLinks(p.id).entries.find(x=>x.kind==='case'&&x.ref===caseId)
 assert.equal(linked.valid,true)
 assert.equal(linked.revision,1)
 assert.throws(()=>attachProjectItem(p.id,'case','not-a-case'))
 writeFileSync(join(home,'.reverse-cases',caseId+'.json'),'{"schema":"invalid"}')
 assert.equal(projectLinks(p.id).entries.find(x=>x.kind==='case').valid,false)
})
