/**
 * Actual Session snapshot/fork + same-session concurrent proposal ownership.
 * Invalid/failed durable intentions are not treated as completed compactions.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime,INTENT_EVENT,STATE_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
import {currentAcpSummary} from '/opt/dsh/plugins/dsh-context-manager/acp-pending.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const {Session,SessionId,appendPluginRecord}=await import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href)
const session=Session.create(SessionId('acp-fork-parent'))
const source='Independent source events support crash replay and branch-safe ACP compression. '.repeat(50)
for(let i=0;i<9;i++)session.append('user/message',{
 id:'source-'+i,role:'user',source:{kind:'user'},
 content:[{type:'text',text:source+' '+i}],
},{surfaceOp:'append'})
const commit=async (target,start,end)=>{
 const ids=target.surface.nodes.slice(target.surface.nodes.indexOf(start),target.surface.nodes.indexOf(end)+1)
 const cid='fork-'+target.id+'-'+target.seq
 const startEv=target.append('compaction/start',{compactionId:cid,turn:null})
 const summary=currentAcpSummary(target)?.summary
 assert.ok(summary)
 const sumEv=target.append('compaction/summary',{compactionId:cid,
  summary:[{type:'text',text:summary}],shadowedRange:{start,end},shadowedSeqs:ids,
  shadowedTokenCount:800,provider:'test',model:'offline'})
 target.append('user/message',{
  id:'checkpoint-'+cid,role:'user',source:{kind:'compact-checkpoint',compactionId:cid},
  content:[{type:'text',text:'<compacted-summary>\n'+summary+'\n</compacted-summary>'}],
 },{surfaceOp:{op:'replace',startSeq:start,endSeq:end},
  sourceEventSeqs:[startEv.seq,sumEv.seq,...ids]})
 target.append('compaction/end',{compactionId:cid,turn:null})
 return {compactionId:cid,summarySeq:sumEv.seq}
}
const first=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
const competitor=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
const refs=first.status(session).refs
const opts={startRef:refs[0].ref,endRef:refs[3].ref,
 summary:'Original events and Session seq identity remain immutable and recoverable under concurrent native proposals. '.repeat(2)}
first.propose(session,opts)
assert.throws(()=>competitor.propose(session,opts),/queued/)
await first.processPending({session},{compactRegion:(start,end)=>commit(session,start,end)})
assert.equal(first.status(session).blocks.length,1)
assert.equal(competitor.status(session).blocks.length,1)
const forkId=SessionId('acp-fork-child')
const parentEvents=session.snapshotEvents()
const fork=Session.create(forkId,parentEvents,{
 ...session.header,id:forkId,isSeeded:true,parentSession:session.id,
},parentEvents.length)
const cold=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
assert.equal(cold.status(fork).blocks.length,1)
assert.match(cold.decompress(fork,'b1').original,/Independent source events/)
const childrenRefs=cold.status(fork).refs
cold.propose(fork,{startRef:childrenRefs[0].ref,endRef:childrenRefs[1].ref,
 summary:'Fork child compression must not change any parent node, checkpoint record or ACP block state. '.repeat(2)})
await cold.processPending({session:fork},{compactRegion:(start,end)=>commit(fork,start,end)})
assert.equal(cold.status(fork).blocks.length,2)
assert.equal(first.status(session).blocks.length,1)
assert.equal(parentEvents.length,session.snapshotEvents().length)
assert.ok(fork.snapshotEvents().length>parentEvents.length)
assert.equal(fork.header.isSeeded,true)

// A failure to obtain durable intent acknowledgment MUST suppress compaction.
const failing=Session.create(SessionId('acp-fault-intent'))
for(let i=0;i<7;i++)failing.append('user/message',{
 id:'fault-'+i,role:'user',source:{kind:'user'},
 content:[{type:'text',text:source+' fault '+i}],
},{surfaceOp:'append'})
const noDisk=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>false})
const faultRefs=noDisk.status(failing).refs
noDisk.propose(failing,{startRef:faultRefs[0].ref,endRef:faultRefs[3].ref,
 summary:'A failed durable flush must prevent native compaction despite accepted ACP intent. '.repeat(2)})
let transactions=0
await assert.rejects(()=>noDisk.processPending({session:failing},{async compactRegion(){transactions++}}),
 /lacks durable persistence listener/)
assert.equal(transactions,0)
assert.equal(failing.snapshotEvents().filter(e=>e.type===STATE_EVENT).length,0)
assert.equal(failing.snapshotEvents().filter(e=>e.type===INTENT_EVENT).length,1)
const repaired=Session.create(failing.id,failing.snapshotEvents(),failing.header)
assert.equal(new AcpRuntime({appendRecord:appendPluginRecord}).status(repaired).blocks.length,0)
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_FORK_PASS seeded=true isolated=true concurrency=true failedFlushClosed=true\n')
