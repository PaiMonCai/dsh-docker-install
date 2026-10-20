/**
 * Phase 4 compaction history: deterministic read-only projection of native
 * persisted DSH Session events. Never reconstruct range by numeric seq order:
 * sourceEventSeqs is authoritative after older surface replacements.
 */
const MAX_EVENTS=100000
const MAX_ROWS=512
const MAX_SOURCES=2500
const MAX_SUMMARY_CHARS=16000
const MAX_MESSAGE_CHARS=1600
const SOURCE_TYPES=new Set(['user/message','assistant/message','tool/result'])
export const LIMITS=Object.freeze({events:MAX_EVENTS,rows:MAX_ROWS,sources:MAX_SOURCES})

function integer(n) { return Number.isSafeInteger(n) && n>=0 }
function textBlocks(blocks, max=MAX_SUMMARY_CHARS) {
  if(!Array.isArray(blocks))return ''
  let result=''
  for(const block of blocks) {
    if(block?.type!=='text'||typeof block.text!=='string')continue
    result+=(result?'\n':'')+block.text.slice(0,Math.max(0,max-result.length))
    if(result.length>=max)break
  }
  return result
}
function extractTier(summary) {
  const match=/(?:^|\n)## Context Tier: (T1|T2|T3)(?=\n|$)/.exec(summary)
  return match?.[1]??'native'
}
function sanitizeId(id) {
  return typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)?id:'unknown'
}
function eventMap(events) {
  if(!Array.isArray(events)||events.length>MAX_EVENTS)
    throw Error('history unavailable: session event budget exceeded')
  const map=new Map()
  for(const event of events) {
    if(!integer(event?.seq)||map.has(event.seq))throw Error('history unavailable: invalid event sequence')
    map.set(event.seq,event)
  }
  return map
}
function sourceSeqs(ev) {
  const seqs=ev?.data?.shadowedSeqs
  if(!Array.isArray(seqs)||seqs.length<1||seqs.length>MAX_SOURCES
    ||seqs.some(seq=>!integer(seq))||new Set(seqs).size!==seqs.length)
    return null
  return seqs
}
function observedSummary(summaryEvent, transaction, nextEvent) {
  const d=summaryEvent.data
  if(!transaction||!d||d.compactionId!==transaction.id)return null
  const seqs=sourceSeqs(summaryEvent)
  if(!seqs)return null
  if(nextEvent?.seq!==summaryEvent.seq+1||nextEvent.type!=='user/message')return null
  if(nextEvent.surfaceOp?.op!=='replace')return null
  if(nextEvent.surfaceOp.startSeq!==d.shadowedRange?.start
    ||nextEvent.surfaceOp.endSeq!==d.shadowedRange?.end)return null
  if(nextEvent.data?.source?.kind!=='compact-checkpoint'
    ||nextEvent.data?.source?.compactionId!==transaction.id)return null
  const refs=nextEvent.sourceEventSeqs
  if(!Array.isArray(refs)||!refs.includes(transaction.startSeq)
    ||!refs.includes(summaryEvent.seq)||!seqs.every(s=>refs.includes(s)))return null
  const summary=textBlocks(d.summary)
  if(!summary.trim())return null
  return {
    summarySeq:summaryEvent.seq,startSeq:transaction.startSeq,
    checkpointSeq:nextEvent.seq,compactionId:String(transaction.id),
    tier:extractTier(summary),provider:sanitizeId(d.provider),
    model:typeof d.model==='string'?d.model.slice(0,128):'unknown',
    tokens:integer(d.shadowedTokenCount)?d.shadowedTokenCount:0,
    sourceCount:seqs.length,sourceSeqs:seqs,summary,
    time:integer(summaryEvent.time)?summaryEvent.time:null,
  }
}
/** Return a detached index. A failed/unclosed native transaction is never a success. */
export function indexCompactions(inspection) {
  const events=inspection?.events
  const bySeq=eventMap(events)
  const transactions=new Map()
  let invalid=0
  const output=[]
  for(const ev of events) {
    if(ev.type==='compaction/start') {
      const id=ev.data?.compactionId
      if(id===undefined||transactions.has(id)){invalid++;continue}
      transactions.set(id,{id,startSeq:ev.seq,summary:null})
    } else if(ev.type==='compaction/summary'){
      const txn=transactions.get(ev.data?.compactionId)
      if(!txn||txn.summary!==null){invalid++;continue}
      const row=observedSummary(ev,txn,bySeq.get(ev.seq+1))
      if(!row){invalid++;continue}
      txn.summary=row
    } else if(ev.type==='compaction/end') {
      const id=ev.data?.compactionId
      const txn=transactions.get(id)
      if(!txn){invalid++;continue}
      transactions.delete(id)
      if(ev.data?.error!==undefined||!txn.summary){invalid++;continue}
      if(output.length>=MAX_ROWS)throw Error('history unavailable: compaction index budget exceeded')
      output.push({ ...txn.summary, endSeq:ev.seq })
    }
  }
  invalid+=transactions.size
  output.sort((a,b)=>b.summarySeq-a.summarySeq)
  return {
    sessionId:sanitizeId(inspection?.meta?.id),
    total:output.length,incomplete:invalid,
    eventCount:events.length,revision:events.length,
    rows:output,
  }
}
export function publicIndex(index,{offset=0,limit=20,query=''}={}) {
  if(!integer(offset)||!Number.isInteger(limit)||limit<1||limit>50)
    throw Error('invalid history pagination')
  if(typeof query!=='string'||query.length>80)throw Error('invalid history query')
  const q=query.trim().toLocaleLowerCase()
  const filtered=q?index.rows.filter(r=>r.summary.toLocaleLowerCase().includes(q)
    ||r.tier.toLowerCase().includes(q)):index.rows
  return {
    sessionId:index.sessionId,revision:index.revision,
    total:filtered.length,incomplete:index.incomplete,
    items:filtered.slice(offset,offset+limit).map(row=>({
      summarySeq:row.summarySeq,startSeq:row.startSeq,endSeq:row.endSeq,
      checkpointSeq:row.checkpointSeq,tier:row.tier,provider:row.provider,
      model:row.model,sourceCount:row.sourceCount,tokens:row.tokens,time:row.time,
      preview:row.summary.slice(0,180),
    })),
    nextOffset:offset+limit<filtered.length?offset+limit:null,
  }
}
export function summaryDetail(index,summarySeq) {
  if(!integer(summarySeq))throw Error('invalid summary seq')
  const row=index.rows.find(r=>r.summarySeq===summarySeq)
  if(!row)return null
  return {
    summarySeq:row.summarySeq,tier:row.tier,
    summary:row.summary,sourceCount:row.sourceCount,
    sourceSeqs:row.sourceSeqs.slice(),revision:index.revision,
  }
}
function sourcePreview(ev) {
  const d=ev?.data
  if(!SOURCE_TYPES.has(ev?.type))return {type:ev?.type??'unknown',text:'[不展示该事件类型的原始内容]'}
  const message=d?.message??d
  const text=textBlocks(message?.content,MAX_MESSAGE_CHARS)
  return {type:ev.type,text:text||'[无可展示的文本块]',truncated:text.length>=MAX_MESSAGE_CHARS}
}
export function originalPage(inspection,index,{summarySeq,offset=0,limit=5,revision}={}) {
  if(!integer(summarySeq)||!integer(offset)||!Number.isInteger(limit)||limit<1||limit>10)
    throw Error('invalid source pagination')
  if(revision!==index.revision)throw Error('history changed, refresh before retrieving originals')
  const row=index.rows.find(x=>x.summarySeq===summarySeq)
  if(!row)return null
  const bySeq=eventMap(inspection.events)
  const list=row.sourceSeqs.slice(offset,offset+limit).map(seq=>{
    const event=bySeq.get(seq)
    if(!event)throw Error('history source event unavailable')
    return {seq,time:integer(event.time)?event.time:null,...sourcePreview(event)}
  })
  return {
    summarySeq,revision:index.revision,sourceCount:row.sourceCount,
    items:list,nextOffset:offset+limit<row.sourceSeqs.length?offset+limit:null,
  }
}
