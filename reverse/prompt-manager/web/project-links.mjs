/** Project links: references only; does not execute samples or mutate task records. */
import { existsSync, lstatSync, readFileSync, openSync, writeFileSync, closeSync, renameSync, unlinkSync, mkdirSync, rmdirSync, fsyncSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { join, resolve, relative, sep, isAbsolute } from 'node:path'
import { project } from './projects.mjs'
import { taskDetail, report, caseDetail } from './workbench.mjs'
const ROOT = resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT || '/workspace')
const PROJECT_DIR = join(ROOT, '.reverse-projects')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LIMIT = 120
function targetPath(projectId) { project(projectId); return join(PROJECT_DIR,projectId+'.links.json') }
function readLinks(projectId) {
  const file=targetPath(projectId)
  if (!existsSync(file)) return {schema:'dsh-reverse-project-links/v1',project_id:projectId,entries:[]}
  const st=lstatSync(file)
  if (st.isSymbolicLink() || !st.isFile()||st.size>40000) throw Error('invalid project links')
  const data=JSON.parse(readFileSync(file,'utf8'))
  if (data.schema!=='dsh-reverse-project-links/v1'||data.project_id!==projectId||
      !Array.isArray(data.entries)||data.entries.length>LIMIT) throw Error('invalid links schema')
  return data
}
function writeLinks(projectId,data) {
  const final=targetPath(projectId),temp=join(PROJECT_DIR,'.'+randomUUID()+'.tmp')
  const fd=openSync(temp,'wx',0o600)
  try {writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fsyncSync(fd);closeSync(fd);renameSync(temp,final)}
  catch(e){try{closeSync(fd)}catch{};try{unlinkSync(temp)}catch{};throw e}
}
function localFile(input) {
  if(typeof input!=='string'||input.length>1024||input.includes('\0')||
     isAbsolute(input)||input.split(/[\\/]/).includes('..')) throw Error('invalid relative file')
  const absolute=resolve(ROOT,input)
  const rel=relative(ROOT,absolute)
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)) throw Error('outside workspace')
  let current=ROOT
  for(const part of rel.split(sep)) {
    current=join(current,part)
    if(lstatSync(current).isSymbolicLink()) throw Error('symlink not allowed')
  }
  const stat=lstatSync(absolute)
  if(!stat.isFile()||stat.size>8*1024*1024) throw Error('not a bounded file')
  return {absolute,relative:rel,size:stat.size}
}
export function projectLinks(id) {
  const data=readLinks(id)
  return {schema:data.schema,project_id:id,entries:data.entries.map(item=>{
    if(item.kind==='task') {
      try { const t=taskDetail(item.ref);return {...item,state:t.state,valid:true} }
      catch{return {...item,valid:false}}
    }
    if(item.kind==='case') {
      try { const c=caseDetail(item.ref);return {...item,valid:true,
        revision:c.revision,gate_states:c.gates} }
      catch{return {...item,valid:false}}
    }
    try {
      const f=localFile(item.ref)
      const hash=createHash('sha256').update(readFileSync(f.absolute)).digest('hex')
      return {...item,valid:item.sha256===hash}
    } catch{return {...item,valid:false}}
  })}
}
export function attachProjectItem(id,kind,ref) {
  if(!['sample','task','evidence','case'].includes(kind)) throw Error('invalid link type')
  // mkdir is exclusive across processes: refuse concurrent writes instead of losing updates.
  // A stale lock requires explicit operator review, never silently steal it.
  project(id)
  const lock=join(PROJECT_DIR,id+'.links.lock')
  try {mkdirSync(lock,{mode:0o700})}
  catch(error) {if(error.code==='EEXIST')throw Error('project links are being updated');throw error}
  try {return attachLocked(id,kind,ref)}
  finally {rmdirSync(lock)}
}
function attachLocked(id,kind,ref) {
  const data=readLinks(id)
  let item
  if(kind==='task') {
    if(typeof ref!=='string'||!UUID.test(ref)) throw Error('invalid task id')
    const detail=taskDetail(ref)
    item={kind,ref,task_kind:detail.kind}
  } else if(kind==='case') {
    if(typeof ref!=='string'||!UUID.test(ref)) throw Error('invalid case id')
    caseDetail(ref) // Existing, valid case record; keep mutable revision out of the link.
    item={kind,ref}
  } else {
    const file=localFile(ref)
    if(kind==='evidence') report(file.relative) // known-schema reports only
    const hash=createHash('sha256').update(readFileSync(file.absolute)).digest('hex')
    item={kind,ref:file.relative,sha256:hash,size:file.size}
  }
  if(data.entries.some(x=>x.kind===kind&&x.ref===item.ref)) return projectLinks(id)
  if(data.entries.length>=LIMIT) throw Error('project link limit reached')
  data.entries.push({...item,linked_at:new Date().toISOString()})
  writeLinks(id,data)
  return projectLinks(id)
}
