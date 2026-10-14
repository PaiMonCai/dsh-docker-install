/** One-shot operator-confirmed execution: no shell, disabled unless explicitly enabled. */
import { spawn } from 'node:child_process'
import { projectLinks } from './project-links.mjs'
import { taskDetail } from './workbench.mjs'
import { resolve } from 'node:path'
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
const TOKEN='EXECUTE_ONE_PROJECT_TASK'
export async function runProjectTask(id,taskId,confirmation) {
  if(process.env.DSH_REVERSE_WEB_EXECUTION!=='1')
    throw Error('Web execution disabled; set DSH_REVERSE_WEB_EXECUTION=1 to enable')
  if(confirmation!==TOKEN)throw Error('explicit execution confirmation required')
  const links=projectLinks(id)
  if(!links.entries.some(x=>x.kind==='task'&&x.ref===taskId&&x.valid))
    throw Error('task is not linked to this project')
  const selected=taskDetail(taskId)
  if(selected.state!=='queued')throw Error('only queued tasks can be executed')
  // The CLI queue worker operates on the oldest queued task globally.
  // Do not claim this would run taskId: block when any other queued task exists.
  const { tasks }=await import('./workbench.mjs')
  const queued=tasks().filter(x=>x.state==='queued')
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id))
  if(!queued.length||queued[0].id!==taskId)throw Error('another task is ahead in the global queue')
  return await new Promise((done,reject)=>{
    const worker=spawn('reverse-task',['run-once','--expected-id',taskId],{
      cwd:ROOT,env:{...process.env,DSH_REVERSE_WORKSPACE_ROOT:ROOT},
      stdio:['ignore','pipe','pipe'],shell:false
    })
    let out='',err='',finished=false
    const timeout=setTimeout(()=>worker.kill('SIGTERM'),960000)
    worker.stdout.on('data',chunk=>{out=(out+chunk.toString()).slice(-5000)})
    worker.stderr.on('data',chunk=>{err=(err+chunk.toString()).slice(-2000)})
    worker.on('error',error=>{if(!finished){finished=true;clearTimeout(timeout);reject(error)}})
    worker.on('close',code=>{
      if(finished)return
      finished=true;clearTimeout(timeout)
      try {
        const after=taskDetail(taskId)
        done({id:taskId,state:after.state,exit_code:after.exit_code,
          worker_exit_code:code})
      }catch(error){reject(error)}
    })
  })
}
