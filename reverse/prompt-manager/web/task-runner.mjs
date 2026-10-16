/** One-shot operator-confirmed execution: no shell, disabled unless explicitly enabled. */
import { spawn } from 'node:child_process'
import { queueStatus } from './task-queue-client.mjs'
import { assertWebQueueExecution } from './execution-policy.mjs'
import { projectLinks } from './project-links.mjs'
import { taskDetail } from './workbench.mjs'
import { resolve } from 'node:path'
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
export async function runProjectTask(id,taskId,confirmation) {
  assertWebQueueExecution(confirmation)
  const links=projectLinks(id)
  if(!links.entries.some(x=>x.kind==='task'&&x.ref===taskId&&x.valid))
    throw Error('task is not linked to this project')
  const selected=taskDetail(taskId)
  assertWebQueueExecution(confirmation,selected.kind)
  if(selected.case_id&&!links.entries.some(x=>x.kind==='case'&&x.ref===selected.case_id&&x.valid))
    throw Error('task case is not linked to this project')
  if(selected.state!=='queued')throw Error('only queued tasks can be executed')
  // Exactly the same Python queue implementation decides the oldest task;
  // the worker rechecks --expected-id under its lock to reject races.
  if(queueStatus().head_id!==taskId)throw Error('another task is ahead in the global queue')
  return await new Promise((done,reject)=>{
    const worker=spawn('reverse-task',['run-once','--expected-id',taskId],{
      cwd:ROOT,env:{...process.env,DSH_REVERSE_WORKSPACE_ROOT:ROOT},
      stdio:['ignore','pipe','pipe'],shell:false,detached:true
    })
    let out='',err='',finished=false
    // The CLI starts the analysis tool in this process group. Kill the entire
    // group on timeout, not just the Python queue supervisor.
    let expired=false
    let escalation
    const signalGroup=signal=>{
      if(worker.pid && Number.isSafeInteger(worker.pid)) {
        try {process.kill(-worker.pid,signal)} catch(error) {
          if(error.code!=='ESRCH') throw error
        }
      }
    }
    const timeout=setTimeout(()=>{
      expired=true
      signalGroup('SIGTERM')
      escalation=setTimeout(()=>signalGroup('SIGKILL'),5000)
      escalation.unref()
    },960000)
    timeout.unref()
    const cleanup=()=>{clearTimeout(timeout);if(!expired)clearTimeout(escalation)}
    worker.stdout.on('data',chunk=>{out=(out+chunk.toString()).slice(-5000)})
    worker.stderr.on('data',chunk=>{err=(err+chunk.toString()).slice(-2000)})
    worker.on('error',error=>{if(!finished){finished=true;cleanup();reject(error)}})
    worker.on('close',code=>{
      if(finished)return
      finished=true;cleanup()
      try {
        const after=taskDetail(taskId)
        done({id:taskId,state:after.state,exit_code:after.exit_code,
          worker_exit_code:code,timed_out:expired})
      }catch(error){reject(error)}
    })
  })
}
