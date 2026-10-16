import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=mkdtempSync(join(tmpdir(),'reverse-queue-peek-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=root
process.env.DSH_REVERSE_TASK_CLI=fileURLToPath(new URL('../../bin/reverse-task',import.meta.url))
const {queueCommand,queueStatus}=await import('./task-queue-client.mjs')
test.after(()=>rmSync(root,{recursive:true,force:true}))
test('queue peek retains oldest task even when more than 100 tasks exist',()=>{
 const file=join(root,'control.bin')
 writeFileSync(file,'fixture')
 const first=queueCommand('enqueue','triage',file)
 for(let i=0;i<105;i++)queueCommand('enqueue','triage',file)
 const snapshot=queueStatus()
 assert.equal(snapshot.head_id,first.id)
 assert.equal(snapshot.queued_count,106)
 assert.equal(snapshot.staged_count,0)
 assert.ok(!JSON.stringify(snapshot).includes(file))
 assert.ok(!JSON.stringify(snapshot).includes('inputs'))
 const staged=queueCommand('enqueue','triage',file,'--stage')
 assert.equal(queueStatus().staged_count,1)
 queueCommand('discard',staged.id)
 assert.equal(queueStatus().staged_count,0)
})
