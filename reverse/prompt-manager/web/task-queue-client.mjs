/** Only bridge for the image-owned Python queue. No arbitrary commands or shell. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
const BIN=process.env.DSH_REVERSE_TASK_CLI||'/usr/local/bin/reverse-task'
export function queueCommand(...args){
  const child=spawnSync(BIN,args,{
    cwd:ROOT,env:{...process.env,DSH_REVERSE_WORKSPACE_ROOT:ROOT},
    encoding:'utf8',timeout:20000,maxBuffer:1024*1024,shell:false
  })
  if(child.error||child.status!==0)throw Error(
    'reverse-task refused operation: '+String(child.stderr||child.error?.message||'unknown').slice(0,250))
  const result=JSON.parse(child.stdout)
  if(!result||typeof result!=='object')throw Error('invalid task CLI response')
  return result
}
export function queueStatus(){
  const snapshot=queueCommand('peek')
  if(snapshot.schema!=='dsh-reverse-queue-status/v1'||
    !(snapshot.head_id===null||typeof snapshot.head_id==='string')||
    !Number.isSafeInteger(snapshot.queued_count)||snapshot.queued_count<0||
    !Number.isSafeInteger(snapshot.staged_count)||snapshot.staged_count<0||
    !Number.isSafeInteger(snapshot.interrupted_count)||snapshot.interrupted_count<0)
    throw Error('invalid queue status response')
  // Never return CLI task inputs, sample paths, logs or arbitrary JSON fields.
  return {schema:snapshot.schema,head_id:snapshot.head_id,
    head_kind:typeof snapshot.head_kind==='string'?snapshot.head_kind.slice(0,32):null,
    queued_count:snapshot.queued_count,staged_count:snapshot.staged_count,
    interrupted_count:snapshot.interrupted_count}
}
