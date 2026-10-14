/** Enqueue allowlisted offline tasks for a selected Reverse project.
 * Enqueue only: the operator still runs reverse-task run-once explicitly. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, lstatSync, readdirSync, openSync, writeFileSync, closeSync, unlinkSync, readFileSync, fsyncSync, renameSync } from 'node:fs'
import { resolve, relative, sep, join, isAbsolute } from 'node:path'
import { project } from './projects.mjs'
import { projectLinks, attachProjectItem } from './project-links.mjs'
import { projects } from './projects.mjs'
import { auditRecovery } from './recovery-audit.mjs'
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT || '/workspace')
const STORE=join(ROOT,'.reverse-tasks')
const ALLOW={triage:1,'js-triage':1,ghidra:1,diff:2,verify:1}
function boundedInput(value) {
  if(typeof value!=='string'||value.length>1024||!value ||
    isAbsolute(value)||value.split(/[\\/]/).includes('..')||value.includes('\0'))
    throw Error('invalid workspace-relative input')
  const path=resolve(ROOT,value),rel=relative(ROOT,path)
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('outside workspace')
  let cursor=ROOT
  if(lstatSync(cursor).isSymbolicLink())throw Error('unsafe root')
  for(const segment of rel.split(sep)) {
    cursor=join(cursor,segment)
    if(lstatSync(cursor).isSymbolicLink())throw Error('symlink input forbidden')
  }
  const stat=lstatSync(path)
  if(!stat.isFile()&&!stat.isDirectory())throw Error('missing input')
  return path
}
function validateTaskStore() {
  if(!readdirSync(ROOT).includes('.reverse-tasks'))mkdirSync(STORE,{mode:0o700})
  const stat=lstatSync(STORE)
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('unsafe task store')
  if(readdirSync(STORE).filter(x=>x.endsWith('.json')).length>=300)
    throw Error('queue capacity reached')
}
export function createProjectTask(projectId,kind,inputs) {
  project(projectId)
  if(!Object.hasOwn(ALLOW,kind)||!Array.isArray(inputs)||inputs.length!==ALLOW[kind])
    throw Error('invalid allowlisted task')
  // Protect project linkage capacity before creating the task.
  if(projectLinks(projectId).entries.length>=120)throw Error('project links at capacity')
  const paths=inputs.map(boundedInput)
  validateTaskStore()
  const id=randomUUID(),now=new Date().toISOString()
  const data={schema:'dsh-reverse-task/v1',id,kind,inputs:paths,state:'staging',
    attempts:0,created_at:now,updated_at:now,result:null,last_error:null}
  const file=join(STORE,id+'.json')
  const fd=openSync(file,'wx',0o600)
  try {writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fsyncSync(fd)}
  finally {closeSync(fd)}
  // Only queued tasks are executable; linking happens while the task is staged.
  // If the process crashes, recovery can decide whether to commit or discard.
  try {attachProjectItem(projectId,'task',id)}
  catch(e){unlinkSync(file);throw e}
  publishQueued(file,data)
  return {id,kind,state:'queued',project_id:projectId}
}

function publishQueued(file,data) {
  const temp=file+'.'+randomUUID()+'.tmp'
  const fd=openSync(temp,'wx',0o600)
  try {
    writeFileSync(fd,JSON.stringify({...data,state:'queued',updated_at:new Date().toISOString()},null,2)+'\n')
    fsyncSync(fd)
    closeSync(fd)
    renameSync(temp,file)
  } catch(e) {
    try{closeSync(fd)}catch{}
    try{unlinkSync(temp)}catch{}
    throw e
  }
}
/** Operator-triggered recovery, limited to staged tasks belonging to this project. */
export function recoverProjectTasks(projectId) {
  const links=projectLinks(projectId)
  const ids=new Set(links.entries.filter(x=>x.kind==='task').map(x=>x.ref))
  const recovered=[],skipped=[]
  for(const id of ids) {
    try {
      const file=join(STORE,id+'.json')
      const stat=lstatSync(file)
      if(!stat.isFile()||stat.size>30000)throw Error('unsafe task')
      const data=JSON.parse(readFileSync(file,'utf8'))
      if(data.id!==id||data.schema!=='dsh-reverse-task/v1'||data.state!=='staging')continue
      if(!Array.isArray(data.inputs)||data.inputs.length!==ALLOW[data.kind])throw Error('invalid task inputs')
      data.inputs.forEach(value=>{
        // Original absolute input paths must still be workspace-confined.
        const rel=relative(ROOT,value)
        if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('unsafe input')
        boundedInput(rel)
      })
      publishQueued(file,data)
      recovered.push(id)
    }catch {skipped.push(id)}
  }
  auditRecovery({project_id:projectId,recovered,skipped})
  return {recovered,skipped}
}

/** Read-only inventory: only staged JSON tasks; no deletion or implicit recovery. */
export function inspectOrphanTasks() {
  validateTaskStore()
  const linked=new Set()
  for(const p of projects()) {
    try {
      for(const item of projectLinks(p.id).entries)if(item.kind==='task')linked.add(item.ref)
    } catch { /* Invalid project indices must not cause execution or deletion. */ }
  }
  const orphan=[],linkedStaged=[],invalid=[]
  const names=readdirSync(STORE).filter(x=>x.endsWith('.json')).slice(0,300)
  for(const name of names) {
    try {
      const id=name.slice(0,-5)
      if(!/^[0-9a-f-]{36}$/.test(id))continue
      const path=join(STORE,name),st=lstatSync(path)
      if(!st.isFile()||st.size>30000)throw Error('unsafe record')
      const d=JSON.parse(readFileSync(path,'utf8'))
      if(d.id!==id||d.schema!=='dsh-reverse-task/v1')throw Error('invalid record')
      if(d.state==='staging')(linked.has(id)?linkedStaged:orphan).push(id)
    } catch {invalid.push(name.slice(0,80))}
  }
  return {orphan,linked_staged:linkedStaged,invalid}
}

/** Explicit reconciliation: existing successful reports only, never executes tasks. */
export function reconcileProjectResults(projectId) {
  const links=projectLinks(projectId), added=[], skipped=[]
  for(const item of links.entries.filter(x=>x.kind==='task'&&x.valid)) {
    try {
      const file=join(STORE,item.ref+'.json')
      const stat=lstatSync(file)
      if(!stat.isFile()||stat.size>30000)throw Error('unsafe record')
      const task=JSON.parse(readFileSync(file,'utf8'))
      if(task.id!==item.ref||task.schema!=='dsh-reverse-task/v1'||task.state!=='succeeded')continue
      let path
      if(task.kind==='ghidra')path='reverse-analysis/task-'+task.id+'/functions.json'
      else if(task.kind==='triage')path=JSON.parse(task.result?.stdout||'{}').report
      else continue
      if(typeof path!=='string')throw Error('missing report')
      const absolute=resolve(ROOT,path),rel=relative(ROOT,absolute)
      if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('outside workspace')
      attachProjectItem(projectId,'evidence',rel)
      added.push(rel)
    } catch {
      skipped.push(item.ref)
    }
  }
  return {added:[...new Set(added)],skipped,links:projectLinks(projectId)}
}
