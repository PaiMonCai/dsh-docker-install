/**
 * Multi-generation live Session integration: four T1 -> two T2 -> one T3.
 * DSH retains immutable original source events after native surface replaces.
 * Uses real installed ACP kernel with a deterministic transaction double;
 * real compactRegion is independently tested in ACP real-region fixture.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime,STATE_EVENT,INTENT_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
import {currentAcpSummary} from '/opt/dsh/plugins/dsh-context-manager/acp-pending.mjs'
const requireDsh=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const {Session,SessionId,appendPluginRecord}=await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-session')).href)
const session=Session.create(SessionId('acp-native-t3-replay'))
const invariant='Stable verified source fact must survive nested multi-level ACP compaction. '.repeat(20)
for(let i=0;i<21;i++)session.append('user/message',{
  id:'original-'+i,role:'user',source:{kind:'user'},
  content:[{type:'text',text:invariant+' source-'+i}]
},{surfaceOp:'append'})
const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
let n=0
const native={
 async compactRegion(start,end){
  const ids=session.surface.nodes
  const first=ids.indexOf(start),last=ids.indexOf(end)
  assert.ok(first>=0&&last>first)
  const covered=ids.slice(first,last+1)
  const compactionId='nested-'+ ++n
  const summary=currentAcpSummary(session)?.summary
  assert.ok(summary)
  const opened=session.append('compaction/start',{compactionId,turn:null})
  const detail=session.append('compaction/summary',{
    compactionId,summary:[{type:'text',text:summary}],
    shadowedRange:{start,end},shadowedSeqs:covered,shadowedTokenCount:650,
    provider:'deterministic',model:'offline',
  })
  session.append('user/message',{id:'checkpoint-'+n,role:'user',
    source:{kind:'compact-checkpoint',compactionId},
    content:[{type:'text',text:'<compacted-summary>\n'+summary+'\n</compacted-summary>'}]
  },{surfaceOp:{op:'replace',startSeq:start,endSeq:end},
    sourceEventSeqs:[opened.seq,detail.seq,...covered]})
  session.append('compaction/end',{compactionId,turn:null})
  return {compactionId,summarySeq:detail.seq}
 }
}
async function compress(startRef,endRef,tier,label){
 const summary=('Tier '+tier+' '+label+': every original fact, constraint, document identity, user decision and outstanding action remains recoverable by DSH native immutable Session event refs. ').repeat(2)
 const prepared=runtime.propose(session,{startRef,endRef,summary,topic:label})
 assert.equal(prepared.tier,tier)
 await runtime.processPending({session},native,new AbortController().signal)
 const s=runtime.status(session)
 assert.ok(s.blocks.some(b=>b.id===prepared.block&&b.tier===tier))
 return prepared.block
}
for(let i=0;i<4;i++){
 const refs=runtime.status(session).refs
 await compress(refs[0].ref,refs[2].ref,1,'T1-generation-'+i)
}
assert.deepEqual(runtime.status(session).blocks.map(b=>b.id).sort(),['b1','b2','b3','b4'])
const t2a=await compress('b1','b2',2,'T2-left')
const t2b=await compress('b3','b4',2,'T2-right')
assert.deepEqual(runtime.status(session).blocks.map(b=>b.id).sort(),[t2a,t2b].sort())
const t3=await compress(t2a,t2b,3,'T3-final')
const status=runtime.status(session)
assert.deepEqual(status.blocks.map(b=>b.id),[t3])
assert.equal(status.blocks[0].tier,3)
const orig=runtime.decompress(session,t3)
assert.ok(orig.originalCount>=12)
assert.match(orig.original,/Stable verified source fact/)
const cold=Session.create(session.id,session.snapshotEvents(),session.header)
const replay=new AcpRuntime({appendRecord:appendPluginRecord})
assert.deepEqual(replay.status(cold).blocks.map(b=>b.id),[t3])
assert.equal(replay.decompress(cold,t3).originalCount,orig.originalCount)
assert.equal(cold.snapshotEvents().filter(e=>e.type===STATE_EVENT).length,7)
assert.equal(cold.snapshotEvents().filter(e=>e.type===INTENT_EVENT).length,7)
assert.equal(cold.snapshotEvents().filter(e=>e.type==='compaction/end').length,7)
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_T3_PASS levels=3 transactions=7 sourceReplay=true\n')
