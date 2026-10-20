/**
 * Run inside the DSH image after acp-kernel is installed; no API credentials.
 * Verify the actual published kernel is called and the DSH log is authoritative.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime,STATE_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
import {INTENT_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-recovery.mjs'
import {currentAcpSummary} from '/opt/dsh/plugins/dsh-context-manager/acp-pending.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const dsh=await import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href)
const {Session,SessionId,appendPluginRecord}=dsh
const session=Session.create(SessionId('acp-native-disposable'))
const original='A verified original statement must remain recoverable after compaction. '.repeat(48)
for(let i=0;i<8;i++){
  session.append('user/message',{id:'acp-user-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:original+' evidence '+i}]},{surfaceOp:'append'})
}
const kernel=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true,logger:{warn:()=>{}}})
const before=kernel.status(session)
assert.equal(before.kernel,'acp-kernel')
assert.equal(before.refs.length,8)
const proposal=kernel.propose(session,{startRef:before.refs[0].ref,
  endRef:before.refs[3].ref,summary:'User goals are to preserve all verified evidence while keeping a native DSH history and one compression owner. All facts remain grounded. '.repeat(2)})
assert.equal(proposal.accepted,true)
let commits=0
const fakeNativeCompaction={
 async compactRegion(start,end){
  commits++
  const ids=session.surface.nodes.slice(session.surface.nodes.indexOf(start),
    session.surface.nodes.indexOf(end)+1)
  const compactionId='test-native-acp-'+commits
  const begin=session.append('compaction/start',{compactionId,turn:null})
  const sum=session.append('compaction/summary',{
    compactionId,summary:[{type:'text',text:currentAcpSummary(session).summary}],
    shadowedRange:{start,end},shadowedSeqs:ids,shadowedTokenCount:600,
    provider:'offline-test',model:'controlled',
  })
  session.append('user/message',{
    id:'acp-checkpoint-'+commits,role:'user',
    source:{kind:'compact-checkpoint',compactionId},
    content:[{type:'text',text:'<compacted-summary>\n'+currentAcpSummary(session).summary+'\n</compacted-summary>'}],
  },{surfaceOp:{op:'replace',startSeq:start,endSeq:end},
    sourceEventSeqs:[begin.seq,sum.seq,...ids]})
  session.append('compaction/end',{compactionId,turn:null})
  return {compactionId,summarySeq:sum.seq}
 }
}
const result=await kernel.processPending({session},fakeNativeCompaction,new AbortController().signal)
assert.equal(commits,1)
assert.equal(result.block,proposal.block)
assert.equal(session.snapshotEvents().filter(e=>e.type===STATE_EVENT).length,1)
assert.equal(session.snapshotEvents().filter(e=>e.type===INTENT_EVENT).length,1)
const status=kernel.status(session)
assert.ok(status.blocks.some(b=>b.id===proposal.block))
const originals=kernel.decompress(session,proposal.block)
assert.match(originals.original,/verified original statement/)
assert.ok(originals.originalCount>=4)
const restored=Session.create(session.id,session.snapshotEvents(),session.header)
const recovered=new AcpRuntime({appendRecord:appendPluginRecord})
assert.ok(recovered.status(restored).blocks.some(b=>b.id===proposal.block))
assert.match(recovered.decompress(restored,proposal.block).original,/verified original statement/)
assert.equal(kernel.search(session,'verified').length>0,true)
// Inject a crash *after* a complete native checkpoint but *before* the
// ACP state event. A cold Session replay must derive the block ONLY after
// validating the native transaction and the pre-flushed intent.
const failure=Session.create(SessionId('acp-intent-crash'))
for(let i=0;i<7;i++)failure.append('user/message',{
  id:'failure-user-'+i,role:'user',source:{kind:'user'},
  content:[{type:'text',text:original+' crash test '+i}]
},{surfaceOp:'append'})
let durable=0
const crashing=new AcpRuntime({
  appendRecord:(s,type,data)=>{
    if(type===STATE_EVENT)throw Error('synthetic crash after native close')
    return appendPluginRecord(s,type,data)
  },flushIntent:async()=>{durable++;return true},
})
const refs=crashing.status(failure).refs
crashing.propose(failure,{startRef:refs[0].ref,endRef:refs[3].ref,
 summary:'A verified original statement must survive a process crash after native compaction but before ACP state acknowledgment. '.repeat(2),
 topic:'crash test'})
// Reuse the same transaction double with a different Session identity.
const fakeForCrash={compactRegion:async(start,end)=>{
  const covered=failure.surface.nodes.slice(failure.surface.nodes.indexOf(start),failure.surface.nodes.indexOf(end)+1)
  const compactionId='native-crash-case'
  const begin=failure.append('compaction/start',{compactionId,turn:null})
  const summary=currentAcpSummary(failure).summary
  const sum=failure.append('compaction/summary',{compactionId,summary:[{type:'text',text:summary}],
    shadowedRange:{start,end},shadowedSeqs:covered,shadowedTokenCount:1000,
    provider:'controlled',model:'mock'})
  failure.append('user/message',{id:'crash-checkpoint',role:'user',
    source:{kind:'compact-checkpoint',compactionId},
    content:[{type:'text',text:'<compacted-summary>\n'+summary+'\n</compacted-summary>'}]
  },{surfaceOp:{op:'replace',startSeq:start,endSeq:end},
    sourceEventSeqs:[begin.seq,sum.seq,...covered]})
  failure.append('compaction/end',{compactionId,turn:null})
  return {compactionId,summarySeq:sum.seq}
}}
await assert.rejects(()=>crashing.processPending({session:failure},fakeForCrash,new AbortController().signal),
 /synthetic crash/)
assert.equal(durable,1)
assert.equal(failure.snapshotEvents().some(e=>e.type===STATE_EVENT),false)
const cold=Session.create(failure.id,failure.snapshotEvents(),failure.header)
const repair=new AcpRuntime({appendRecord:appendPluginRecord})
const recoveredStatus=repair.status(cold)
assert.equal(recoveredStatus.recoveredFromNativeLog,true)
assert.ok(recoveredStatus.blocks.some(b=>b.id==='b1'))
assert.match(repair.decompress(cold,'b1').original,/verified original statement/)
assert.equal(cold.snapshotEvents().some(e=>e.type===STATE_EVENT),false)
// A failed native transaction is *not* treated as a recovered ACP block.
const aborted=Session.create(SessionId('acp-failed-intent'))
for(let i=0;i<6;i++)aborted.append('user/message',{
  id:'fail-'+i,role:'user',source:{kind:'user'},
  content:[{type:'text',text:original}]
},{surfaceOp:'append'})
const prior=repair.status(aborted).refs
repair.propose(aborted,{startRef:prior[0].ref,endRef:prior[3].ref,
 summary:'The proposed summary cannot be trusted unless a native checkpoint has been durably committed and fully validated. '.repeat(2)})
await assert.rejects(()=>repair.processPending({session:aborted},{
  compactRegion:async()=>{throw Error('synthetic native failure')}
},new AbortController().signal),/synthetic native failure/)
const coldFailed=Session.create(aborted.id,aborted.snapshotEvents(),aborted.header)
const statusFailed=new AcpRuntime({appendRecord:appendPluginRecord}).status(coldFailed)
assert.equal(statusFailed.blocks.length,0)
assert.equal(statusFailed.recoveredFromNativeLog,false)
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_NATIVE_BRIDGE_PASS native=true restored=true\n')
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_RECOVERY_PASS crash=true failed-intent-ignored=true\n')
