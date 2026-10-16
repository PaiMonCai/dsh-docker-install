import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const home=mkdtempSync(join(tmpdir(),'reverse-project-queue-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
process.env.DSH_REVERSE_TASK_CLI=fileURLToPath(new URL('../../bin/reverse-task',import.meta.url))
const {createProject}=await import('./projects.mjs')
const {createProjectTask,reconcileProjectResults,recoverProjectTasks,inspectOrphanTasks}=await import('./project-tasks.mjs')
const {projectLinks}=await import('./project-links.mjs')
const p=createProject('Queued Analysis')
test('enqueue creates durable task and links it to project without executing',()=>{
 writeFileSync(join(home,'sample.bin'),'dummy sample')
 const task=createProjectTask(p.id,'triage',['sample.bin'])
 assert.equal(task.state,'queued')
 const record=JSON.parse(readFileSync(join(home,'.reverse-tasks',task.id+'.json'),'utf8'))
 assert.deepEqual(record.inputs,[join(home,'sample.bin')])
 assert.equal(record.attempts,0)
 assert.ok(projectLinks(p.id).entries.some(x=>x.kind==='task'&&x.ref===task.id))
})
test('successful triage result can be reconciled into validated evidence',()=>{
 const task=createProjectTask(p.id,'triage',['sample.bin'])
 const path=join(home,'evidence.json')
 writeFileSync(path,JSON.stringify({schema:'dsh-reverse-evidence/v1',sample:{},evidence:[]}))
 const file=join(home,'.reverse-tasks',task.id+'.json')
 const record=JSON.parse(readFileSync(file,'utf8'))
 record.state='succeeded'
 record.result={exit_code:0,stdout:JSON.stringify({report:path})}
 writeFileSync(file,JSON.stringify(record))
 const linked=reconcileProjectResults(p.id)
 assert.ok(linked.added.includes('evidence.json'))
 assert.ok(projectLinks(p.id).entries.some(x=>x.kind==='evidence'&&x.ref==='evidence.json'&&x.valid))
})
test('reject invalid work, unknown project, traversal and no implicit execution',()=>{
 assert.throws(()=>createProjectTask(p.id,'shell',['sample.bin']))
 assert.throws(()=>createProjectTask(p.id,'diff',['sample.bin']))
 assert.throws(()=>createProjectTask(p.id, 'triage', ["../outside"]))
 assert.throws(()=>createProjectTask('bad','triage',['sample.bin']))
})
test('recovery commits only linked staged records after validation',()=>{
 const task=createProjectTask(p.id,'triage',['sample.bin'])
 const file=join(home,'.reverse-tasks',task.id+'.json')
 const data=JSON.parse(readFileSync(file,'utf8'))
 data.state='staging'
 writeFileSync(file,JSON.stringify(data))
 assert.equal(recoverProjectTasks(p.id).recovered.includes(task.id),true)
 assert.equal(JSON.parse(readFileSync(file,'utf8')).state,'queued')
 assert.deepEqual(recoverProjectTasks(p.id).recovered,[])
})
test('orphan staging tasks are only inventoried; recovery is audited',()=>{
 const existing=createProjectTask(p.id,'triage',['sample.bin'])
 const file=join(home,'.reverse-tasks',existing.id+'.json')
 const state=JSON.parse(readFileSync(file,'utf8'));state.state='staging'
 writeFileSync(file,JSON.stringify(state))
 const id='00000000-0000-4000-8000-000000000001'
 writeFileSync(join(home,'.reverse-tasks',id+'.json'),JSON.stringify({...state,id}))
 const found=inspectOrphanTasks()
 assert.ok(found.orphan.includes(id))
 assert.ok(found.linked_staged.includes(existing.id))
 const recovered=recoverProjectTasks(p.id)
 assert.ok(recovered.recovered.includes(existing.id))
 assert.equal(JSON.parse(readFileSync(join(home,'.reverse-tasks',id+'.json'),'utf8')).state,'staging')
 const logs=readFileSync(join(home,'.reverse-tasks','recovery-audit.jsonl'),'utf8').trim().split('\n')
 assert.ok(logs.some(line=>JSON.parse(line).recovered.includes(existing.id)))
})
test.after(()=>rmSync(home,{force:true,recursive:true}))

test('case-linked Web tasks are written by the same CLI and checked against target',async()=>{
 const caseId='e7118029-70b9-4aa0-a774-733b98c72f21'
 mkdirSync(join(home,'.reverse-cases'),{recursive:true})
 writeFileSync(join(home,'.reverse-cases',caseId+'.json'),JSON.stringify({
   schema:'dsh-reverse-case/v1',id:caseId,revision:1,goal:'inspect',
   target:{path:'sample.bin',sha256:'abc'},gates:{},evidence:[],
   hypotheses:[],experiments:[],tasks:[]
 }))
 assert.throws(()=>createProjectTask(p.id,'triage',['sample.bin'],caseId),/linked/)
 const {attachProjectItem}=await import('./project-links.mjs')
 attachProjectItem(p.id,'case',caseId)
 const created=createProjectTask(p.id,'triage',['sample.bin'],caseId)
 const stored=JSON.parse(readFileSync(join(home,'.reverse-tasks',created.id+'.json'),'utf8'))
 assert.equal(stored.case_id,caseId)
 assert.equal(stored.state,'queued')
 assert.equal(projectLinks(p.id).entries.find(x=>x.kind==='case').valid,true)
})

test('RPC allowlist exposes existing recovery and orphan inspection operations',async()=>{
 const {command}=await import('./index.mjs')
 const inventory=command('workbenchOrphanTasks')
 assert.ok(Array.isArray(inventory.orphan))
 const result=command('workbenchProjectTasksRecover',{id:p.id})
 assert.ok(Array.isArray(result.recovered))
 assert.ok(Array.isArray(result.skipped))
})
