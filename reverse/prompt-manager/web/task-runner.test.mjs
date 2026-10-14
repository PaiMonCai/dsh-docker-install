import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const root=mkdtempSync(join(tmpdir(),'reverse-run-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=root
const {createProject}=await import('./projects.mjs')
const {createProjectTask}=await import('./project-tasks.mjs')
const {runProjectTask}=await import('./task-runner.mjs')
const p=createProject('Exec Guard')
writeFileSync(join(root,'fixture.bin'),'test')
const t=createProjectTask(p.id,'triage',['fixture.bin'])
test('web execution is disabled by default',async()=>{
 delete process.env.DSH_REVERSE_WEB_EXECUTION
 await assert.rejects(runProjectTask(p.id,t.id,'EXECUTE_ONE_PROJECT_TASK'),/disabled/)
})
test('web execution requires explicit confirmation and project association',async()=>{
 process.env.DSH_REVERSE_WEB_EXECUTION='1'
 await assert.rejects(runProjectTask(p.id,t.id,''),/confirmation/)
 await assert.rejects(runProjectTask(p.id,'not-a-valid-id','EXECUTE_ONE_PROJECT_TASK'))
 delete process.env.DSH_REVERSE_WEB_EXECUTION
})
test.after(()=>rmSync(root,{recursive:true,force:true}))

test('runner uses an isolated process group and has escalation logic',async()=>{
 const {readFileSync}=await import('node:fs')
 const {fileURLToPath}=await import('node:url')
 const {join,dirname}=await import('node:path')
 const source=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'task-runner.mjs'),'utf8')
 assert.match(source,/detached:true/)
 assert.match(source,/process\.kill\(-worker\.pid/)
 assert.match(source,/SIGKILL/)
})
