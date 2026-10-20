/**
 * Reproducible OFFLINE DSH Session projection benchmark, not an API pricing
 * claim. Prints throughput and model-visible character/token estimates.
 */
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
import {currentAcpSummary} from '/opt/dsh/plugins/dsh-context-manager/acp-pending.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const {Session,SessionId,appendPluginRecord}=await import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href)
const session=Session.create(SessionId('acp-offline-benchmark'))
const material='Original event evidence, goal, agent decision and exact context. '.repeat(70)
for(let i=0;i<36;i++){
 session.append('user/message',{
  id:'bench-'+i,role:'user',source:{kind:'user'},
  content:[{type:'text',text:'Sequence '+i+': '+material}],
 },{surfaceOp:'append'})
}
const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
const before=runtime.status(session)
let done=0
const backend={async compactRegion(start,end){
 const seqs=session.surface.nodes.slice(session.surface.nodes.indexOf(start),session.surface.nodes.indexOf(end)+1)
 const id='benchmark-'+ ++done
 const summary=currentAcpSummary(session)?.summary
 assert.ok(summary)
 const opened=session.append('compaction/start',{compactionId:id,turn:null})
 const row=session.append('compaction/summary',{compactionId:id,
  summary:[{type:'text',text:summary}],shadowedRange:{start,end},shadowedSeqs:seqs,
  shadowedTokenCount:seqs.length*600,provider:'offline',model:'deterministic'})
 session.append('user/message',{id:'bench-checkpoint-'+done,role:'user',
  source:{kind:'compact-checkpoint',compactionId:id},
  content:[{type:'text',text:'<compacted-summary>\n'+summary+'\n</compacted-summary>'}]},
  {surfaceOp:{op:'replace',startSeq:start,endSeq:end},
   sourceEventSeqs:[opened.seq,row.seq,...seqs]})
 session.append('compaction/end',{compactionId:id,turn:null})
 return {compactionId:id,summarySeq:row.seq}
}}
const t0=performance.now()
for(let i=0;i<3;i++){
 const refs=runtime.status(session).refs
 runtime.propose(session,{startRef:refs[0].ref,endRef:refs[7].ref,
  topic:'synthetic benchmark batch '+i,summary:('Batch '+i+' evidence, exact requirements and decisions from eight source messages remain recoverable in original native DSH events, without any provider call. ').repeat(2)})
 await runtime.processPending({session},backend,new AbortController().signal)
}
const after=runtime.status(session)
const cold=Session.create(session.id,session.snapshotEvents(),session.header)
const restored=new AcpRuntime({appendRecord:appendPluginRecord}).status(cold)
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_BENCH_DIAG '+JSON.stringify({
  activeLive:after.blocks.map(b=>b.id),
  activeCold:restored.blocks.map(b=>b.id),
  checkpointCount:session.snapshotEvents().filter(e=>e.type==='user/message'&&e.data?.source?.kind==='compact-checkpoint').length,
  currentSurface:session.surface.nodes.map(seq=>({
    seq,kind:session.eventAt(seq)?.data?.source?.kind??session.eventAt(seq)?.type,
  })),
  recordedStates:session.snapshotEvents().filter(e=>e.type==='plugin:dsh-docker-context-manager/acp-state')
   .map(e=>({seq:e.seq,active:e.data.state.blocks.filter(b=>b.active).map(b=>b.blockId),
     checkpoints:Object.values(e.data.checkpoints)}))
})+'\\n')
assert.equal(restored.blocks.length,3)
assert.ok(after.tokenEstimate<before.tokenEstimate)
const timings=[]
for(let i=0;i<50;i++){const a=performance.now();runtime.status(session);timings.push(performance.now()-a)}
timings.sort((a,b)=>a-b)
const result={
 fixture:'offline-native-ACP-session',notRealProviderBenchmark:true,
 beforeVisibleTokenEstimate:before.tokenEstimate,
 afterVisibleTokenEstimate:after.tokenEstimate,
 reductionPct:Math.round(100*(1-after.tokenEstimate/before.tokenEstimate)*100)/100,
 nativeCompactionTransactions:done,
 originalSourceMessages:36,replayedBlocks:restored.blocks.length,
 commitElapsedMs:Math.round(performance.now()-t0),
 statusP95Ms:Number(timings[Math.floor(timings.length*.95)].toFixed(3)),
 heapUsedMb:Number((process.memoryUsage().heapUsed/1024/1024).toFixed(2)),
}
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_BENCH_PASS '+JSON.stringify(result)+'\n')
