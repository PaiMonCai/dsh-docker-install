/**
 * Phase 10: replay-safe ACP intent recovery from the authoritative DSH log.
 * Recovery NEVER trusts an intent alone. The native compaction must have a
 * CLOSED, validated start → summary → checkpoint replace → end transaction.
 * This is a pure projection, so cold reads do not mutate their Session.
 */
import { indexCompactions } from './history-index.mjs'
export const INTENT_EVENT='plugin:dsh-docker-context-manager/acp-intent'
export const STATE_EVENT='plugin:dsh-docker-context-manager/acp-state'
function ownRecord(ev,type) {
  if(ev?.type!==type)return false
  if(ev.ignorable!==true||ev.data?.version!==1||!ev.data.state?.messageRefs)
    throw Error('unverifiable native ACP plugin event: '+type)
  return true
}
function validateIntent(data) {
  const block=data.state.blocks?.find(b=>b.blockId===data.blockId)
  if(!block||!block.active||block.summary!==data.summary
    ||!Number.isSafeInteger(data.startSeq)||!Number.isSafeInteger(data.endSeq)
    ||typeof data.summary!=='string'||data.summary.length>12000
    ||!data.checkpoints||typeof data.checkpoints!=='object')
    throw Error('native ACP recovery intent corrupt')
}
export function replayAcpState(session) {
  const events=session.snapshotEvents()
  let lastState=null, lastStateIndex=-1
  for(let i=events.length-1;i>=0;i--){
    if(ownRecord(events[i],STATE_EVENT)){
      lastState=events[i].data;lastStateIndex=i;break
    }
  }
  let selected=null
  for(let i=lastStateIndex+1;i<events.length;i++){
    if(ownRecord(events[i],INTENT_EVENT)){
      validateIntent(events[i].data)
      selected={event:events[i],index:i}
    }
  }
  if(!selected)return lastState
  // A prior successful intent without a final state event would have had
  // its data superseded by a later proposal. Do not guess in that situation.
  const span=events.slice(lastStateIndex+1)
  const successful=indexCompactions({meta:{id:session.id},events}).rows
  const proposals=span.filter(e=>e.type===INTENT_EVENT)
  const matches=[]
  for(const proposal of proposals){
    validateIntent(proposal.data)
    const subsequent=span.filter(e=>e.type==='compaction/start'&&e.seq>proposal.seq)
    const nextProposal=proposals.find(p=>p.seq>proposal.seq)
    const inWindow=subsequent.filter(e=>!nextProposal||e.seq<nextProposal.seq)
    if(inWindow.length>1)throw Error('ambiguous native ACP transaction ownership')
    if(!inWindow.length)continue
    const begin=inWindow[0]
    const found=successful.find(row=>row.startSeq===begin.seq)
    if(!found){
      const closed=events.find(e=>e.type==='compaction/end'&&e.data?.compactionId===begin.data?.compactionId)
      if(!closed)throw Error('native ACP compaction unfinished; refuse state recovery')
      if(closed.data?.error===undefined)
        throw Error('native ACP transaction missing valid summary checkpoint')
      continue
    }
    const d=proposal.data
    if(found.compactionId!==begin.data.compactionId
      ||found.summary!==d.summary
      ||found.sourceSeqs[0]!==d.startSeq
      ||found.sourceSeqs.at(-1)!==d.endSeq)
      throw Error('native ACP intent/compaction provenance mismatch')
    matches.push({proposal,found})
  }
  if(matches.length>1)throw Error('multiple uncommitted native ACP transactions')
  if(!matches.length)return lastState
  const {proposal,found}=matches[0]
  const state=proposal.data.state
  return {
    version:1,state,
    checkpoints:{...proposal.data.checkpoints,[String(found.checkpointSeq)]:proposal.data.blockId},
    lastResult:{block:proposal.data.blockId,summarySeq:found.summarySeq,compactionId:found.compactionId},
    recovered:true,
  }
}
