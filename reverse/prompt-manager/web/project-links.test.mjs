import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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
test.after(()=>rmSync(home,{recursive:true,force:true}))
