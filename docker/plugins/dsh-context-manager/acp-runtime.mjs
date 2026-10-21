/**
 * Native DSH ↔ acp-kernel adapter. Kernel output never directly mutates DSH's
 * immutable Session surface. All actual reductions run through ctx.compaction.
 * The original event log remains the only source of conversation truth.
 */
import {
  createCore, createInitialState, defaultConfig, collectBlockContent, summaryMessageId,
  parseCompressArgs, resolveBoundaries,
  applyAbsorb,
  renderNudgeText, defaultCountTokens,
  searchBlocks, blockDocs, getSearchAlgorithm,
} from 'acp-kernel'
import {nativePrompts,nativeNudgeSections} from './acp-prompts.mjs'
import { withAcpSummary,queueAcpSummary,clearQueuedAcpSummary,
  acquireAcpProcessing,ownsAcpProcessing,releaseAcpProcessing } from './acp-pending.mjs'
import { replayAcpState,INTENT_EVENT,STATE_EVENT } from './acp-recovery.mjs'
export { INTENT_EVENT, STATE_EVENT } from './acp-recovery.mjs'

const MAX_ORIGINAL = 4500
const MAX_SUMMARY = 12000
const MAX_ITEMS = 24
const REF = /^m(?:0*[1-9][0-9]{0,6})$/
const BLOCK = /^b[1-9][0-9]*$/

function textOf(content, limit = MAX_ORIGINAL) {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      out += (out ? '\n' : '') + item.text.slice(0, limit - out.length)
      if (out.length >= limit) break
    }
  }
  return out
}
function asMessage(event, isHistoric = false) {
  if (!event || !['user/message','assistant/message','tool/result'].includes(event.type)) return null
  const message = event.type === 'user/message' ? event.data : event.data?.message
  if (!message) return null
  const role = event.type === 'assistant/message' ? 'assistant' : event.type === 'tool/result' ? 'tool' : 'user'
  const text = textOf(message.content, isHistoric ? MAX_ORIGINAL : Number.MAX_SAFE_INTEGER)
  // Stable raw identity, never content-hash-based; seq is immutable under
  // replacements, even when visible surface order no longer follows seq.
  const calls=message.content?.filter(c=>c?.type==='tool-call')??[]
  const call=calls[0]
  return { id: String(event.seq), role,
    contentType: role === 'tool' ? 'tool-result' : call ? 'tool-call' : 'text',
    ...(call?{toolName:call.name,toolCallId:call.id}:{}),
    ...(role==='tool'?{toolCallId:message.toolCallId}:{}),
    text: call ? call.arguments : text || '[non-text or empty message]' }
}
function unsafeEvent(event) {
  if(['system/message','developer/message'].includes(event?.type))return true
  const message=event?.type==='user/message'?event.data:event?.data?.message
  if(!message?.content)return false
  return message.content.some(c=>!['text','tool-call'].includes(c?.type))
    ||message.content.filter(c=>c?.type==='tool-call').length>1
}
function activeMessages(session, checkpoints) {
  const messages=session.surface.nodes.map(seq => {
    const event = session.eventAt(seq)
    const message = asMessage(event)
    if (message && checkpoints?.[String(seq)]) {
      const blockId=checkpoints[String(seq)]
      // Kernel's syncBlocks expects its own summaryMessageId carrier to
      // keep a committed block active after the native DSH Surface replace.
      // This is an IN-MEMORY ACP view only; DSH's durable user/message and
      // checkpoint source are never rewritten into a system message.
      message.id=summaryMessageId(blockId)
      message.role='system'
      message.contentType='text'
      message.summaryOfBlockId=blockId
    }
    return message
  }).filter(Boolean)
  for(const result of messages.filter(m=>m.contentType==='tool-result')) {
    const calls=messages.filter(m=>m.contentType==='tool-call'&&m.toolCallId===result.toolCallId)
    if(calls.length===1)result.toolName=calls[0].toolName
  }
  return messages
}
function historicMessages(session) {
  return session.snapshotEvents().map(ev => asMessage(ev, true)).filter(Boolean)
}
function recordFrom(session) { return replayAcpState(session) }
function stateRevision(session) {return session.snapshotEvents().findLast(e=>e.type===STATE_EVENT)?.seq??-1}
function assertClosedSelectedSteps(session,seqs) {
  const selected=new Set(seqs),open=new Map()
  for(const event of session.snapshotEvents()) {
    const key=JSON.stringify([event.data?.turn,event.data?.step])
    if(event.type==='step/start') {
      if(open.has(key))throw Error('duplicate native step opening')
      open.set(key,false)
    }
    if(selected.has(event.seq))for(const step of open.keys())open.set(step,true)
    if(event.type==='step/end')open.delete(key)
  }
  if([...open.values()].some(Boolean))throw Error('ACP range intersects an unclosed native step')
}
function configFor(session) {
  // The host remains authoritative for actual routed model capacity and
  // overflow recovery. This is only the kernel's pressure/decision window.
  const window = session.requestContext?.()?.contextWindow
  return defaultConfig(Number.isSafeInteger(window) && window > 1024 ? window : 200000, {
    preserveRecentMessages: 0,
    preserveRecentTokens: 0,
    compress: { minCompressRange: 128, minSummaryLength: 50, maxSummaryLength: MAX_SUMMARY },
    // Do not apply kernel-only mutations to a DSH Session. CCR, absorb, crush
    // and emergency truncation require their own native arrival-time events.
    truncate: { threshold: 1, terminalEscapeAfter: 0 },
    ccr: { enabled: false },
    absorb: { enabled: false },
    crush: { enabled: false },
    protectedTools: ['acp_compress'],
    isMessageProtected: message=>unsafeEvent(session.eventAt(Number(message.id))),
  })
}
/** DSH Session.append rejects undefined, non-finite and exotic JSON values.
 * ACP state is portable, but optional internal slots can hold undefined.
 * Canonicalize it at this one storage boundary; reject cycles and oversized
 * or semantically unsafe JSON rather than widening native validation.
 */
function durableJson(value) {
  const raw=JSON.stringify(value,(_key,item)=>{
    if(typeof item==='bigint'||typeof item==='function'||typeof item==='symbol')
      throw Error('unsupported value in ACP kernel state')
    if(typeof item==='number'&&!Number.isFinite(item))
      throw Error('non-finite number in ACP kernel state')
    if(item instanceof Map||item instanceof Set||item instanceof Date)
      throw Error('non-JSON ACP kernel state')
    return item
  })
  if(!raw||raw.length>1048576)throw Error('ACP state exceeds 1 MiB persistence budget')
  return JSON.parse(raw)
}
function fullSummaryBlock(block) {
  return { id:block.blockId, tier:block.tier, topic:block.topic??null,
    summary:block.summary.slice(0,2200), active:!!block.active,
    messageCount:block.effectiveMessageIds.length }
}
export class AcpRuntime {
  constructor({ appendRecord, flushIntent, logger } = {}) {
    if (typeof appendRecord !== 'function') throw Error('native appendPluginRecord required')
    this.appendRecord = appendRecord
    this.flushIntent = flushIntent
    this.logger = logger
    this.core = createCore()
    this.cache = new WeakMap()
    this.pending = new WeakMap()
    this.nudgeCache = new WeakMap()
    this.batches = new WeakMap()
  }
  view(session) {
    let row = this.cache.get(session)
    // DSH's append-only log is authoritative, even when another mounted
    // ContextManager instance independently commits an ACP state record for
    // this same in-memory Session. Never reuse a stale WeakMap projection.
    const events=session.snapshotEvents()
    if(row && (row.observedLogLength>events.length
      || events.slice(row.observedLogLength).some(e=>e.type===STATE_EVENT)))
      row=null
    if (!row) {
      const stored = recordFrom(session)
      row = {
        state: stored?.state ?? createInitialState(),
        checkpoints: stored?.checkpoints ?? {},
        settled: stored?.lastResult ?? null,
        recovered:stored?.recovered===true,
        observedLogLength:events.length,
      }
      this.cache.set(session,row)
    } else row.observedLogLength=events.length
    const messages = activeMessages(session,row.checkpoints)
    const config = configFor(session)
    const route=session.requestContext?.()
    const key=JSON.stringify([session.surface.contentGeneration,config.modelContextLimit,route?.provider,route?.model])
    if(row.projected?.key===key)return {...row.projected.value,row}
    const tokenCount=session.surface.nodes.reduce((total,seq)=>{
      const event=session.eventAt(seq),message=event?.type==='user/message'?event.data:event?.data?.message
      return total+defaultCountTokens(textOf(message?.content,Number.MAX_SAFE_INTEGER))
        +(message?.content??[]).filter(c=>c.type==='tool-call').reduce((n,c)=>n+defaultCountTokens(c.arguments??''),0)
    },0)
    const projected = this.core.processTurn({
      messages,state:row.state,config,tokenCount,renderTags:'none',
    })
    row.state = projected.state
    const value={messages,config,tokenCount,nudge:projected.nudge}
    row.projected={key,value}
    return {row,...value}
  }
  /**
   * Bounded runtime-context recommendation; no user messages, raw tool
   * content, or long cache-fragmenting prompt replacement is generated.
   * Hold it stable across initial assembly and prompt refresh.
   */
  nudgeMessage(session) {
    const generation=JSON.stringify([session.surface.contentGeneration,session.requestContext?.()])
    const cached=this.nudgeCache.get(session)
    if(cached&&cached.generation===generation)return cached.text
    const {nudge}=this.view(session)
    let text=''
    if(nudge?.shouldInject&&!this.pending.has(session)) {
      text=renderNudgeText(nudge,nativePrompts,nativeNudgeSections).text
    }
    this.nudgeCache.set(session,{generation,text})
    return text
  }
  status(session,{offset=0,limit=MAX_ITEMS,blockOffset=0,blockLimit=MAX_ITEMS}={}) {
    for(const [name,value] of Object.entries({offset,blockOffset}))
      if(!Number.isSafeInteger(value)||value<0)throw Error('invalid ACP '+name)
    for(const [name,value] of Object.entries({limit,blockLimit}))
      if(!Number.isSafeInteger(value)||value<1||value>MAX_ITEMS)throw Error('invalid ACP '+name)
    const {row,messages,config,tokenCount,nudge} = this.view(session)
    const refMessages = messages.filter(m=>!m.summaryOfBlockId && row.state.messageRefs.byRaw[m.id]?.startsWith('m'))
    const refs = refMessages.slice(offset,offset+limit).map(m=>({
        ref:row.state.messageRefs.byRaw[m.id],role:m.role,chars:m.text.length,
        // Deliberately omit prompt and tool-result content from a status report.
      }))
    const allBlocks=row.state.blocks.filter(b=>b.active)
    return {kernel:'acp-kernel',surface:'dsh-native',owner:'agent-preset',
      refTotal:refMessages.length,refOffset:offset,
      nextRefOffset:offset+limit<refMessages.length?offset+limit:null,
      blockTotal:allBlocks.length,blockOffset,
      nextBlockOffset:blockOffset+blockLimit<allBlocks.length?blockOffset+blockLimit:null,
      tokenEstimate:tokenCount,window:config.modelContextLimit,
      pending:!!this.pending.get(session),recoveredFromNativeLog:row.recovered,
      nudgeRecommended:!!nudge?.shouldInject,
      blocks:allBlocks.slice(blockOffset,blockOffset+blockLimit).map(fullSummaryBlock),
      refs,latest:row.settled}
  }
  propose(session,args,{preview=false,lease}={}) {
    const parsed=parseCompressArgs(args)
    if(parsed.ranges.length!==1||parsed.diagnostics.invalidItems)
      throw Error('native ACP requires exactly one valid range per proposal')
    const {startRef,endRef,summary,topic}=parsed.ranges[0]
    if (this.pending.has(session)) throw Error('one ACP compression proposal is already queued')
    const plain=REF.test(startRef)&&REF.test(endRef)
    const tiered=BLOCK.test(startRef)&&BLOCK.test(endRef)
    if(!plain&&!tiered)throw Error('ACP native requires matching mNNNNN or bN..bN boundaries')
    if (typeof summary!=='string'||summary.trim().length<80||summary.length>MAX_SUMMARY)
      throw Error('summary must be 80–12000 characters')
    if (topic!==undefined && (typeof topic!=='string'||topic.length>128))
      throw Error('invalid topic')
    const view = this.view(session)
    const {row,messages,config} = view
    let bounds
    try { bounds=resolveBoundaries({startRef,endRef,messages,state:row.state}) }
    catch(error) { throw Error('range must be a current ordered visible span: '+error.message) }
    const {startIndex:first,endIndex:last}=bounds
    if(bounds.reversedNote||bounds.snappedBoundaries.length||bounds.protectedGaps.length)
      throw Error('ACP range must match exact ordered native boundaries without gaps')
    if(first<0||last<0||first>=last)
      throw Error('range must be a current ordered visible span of at least two messages or two blocks')
    const span=messages.slice(first,last+1)
    if(plain&&span.some(m=>m.summaryOfBlockId))
      throw Error('plain ACP message range crosses an active compressed checkpoint; use separate ranges')
    if(tiered&&span.some(m=>!m.summaryOfBlockId))
      throw Error('ACP block merge requires consecutive active block checkpoints only')
    if(tiered && (!row.state.blocks.find(b=>b.active&&b.blockId===startRef)
      || !row.state.blocks.find(b=>b.active&&b.blockId===endRef)))
      throw Error('T2/T3 range must refer to active ACP blocks')
    const nativeSeq=message=>{
      if(!message.summaryOfBlockId)return Number(message.id)
      const original=Object.entries(row.checkpoints).find(([seq,id])=>
        id===message.summaryOfBlockId&&session.surface.nodes.includes(Number(seq)))
      if(!original)throw Error('active ACP block has no matching native checkpoint')
      return Number(original[0])
    }
    // Do not consume the trailing context. DSH's native boundary validator
    // independently protects unmatched tool call/result pairs at commit time.
    if(last>=messages.length-2)throw Error('preserve at least two recent surface messages')
    const firstSeq=nativeSeq(messages[first]),lastSeq=nativeSeq(messages[last])
    const nodes=session.surface.nodes
    const nativeSpan=nodes.slice(nodes.indexOf(firstSeq),nodes.indexOf(lastSeq)+1)
    if(nativeSpan.some(seq=>unsafeEvent(session.eventAt(seq))))
      throw Error('native ACP range contains protected instructions, media or multi-call content')
    assertClosedSelectedSteps(session,nativeSpan)
    for(const message of span.filter(m=>m.toolCallId)) {
      const pair=messages.filter(m=>m.toolCallId===message.toolCallId)
      if(pair.filter(m=>m.contentType==='tool-call').length!==1
        ||pair.filter(m=>m.contentType==='tool-result').length!==1
        ||pair.some(m=>!span.includes(m)))
        throw Error('native ACP requires complete unambiguous tool-call/result pairs')
    }
    const proposal={startRef,endRef,summary:summary.trim(),topic:topic??null,
      firstId:String(firstSeq),lastId:String(lastSeq),
      surfaceGeneration:session.surface.replaceGeneration,stateRevision:stateRevision(session)}
    const draft=this.core.applyCompression({ranges:[{
      startRef,endRef,summary:proposal.summary,
      ...(topic===undefined?{}:{topic}),
    }],messages,state:row.state,config})
    if(draft.result.blocksCreated!==1||draft.result.errors?.length)
      throw Error('ACP kernel rejected range: '+(draft.result.errors??[]).join('; ').slice(0,250))
    proposal.nextState=draft.state
    proposal.newBlock=draft.state.blocks.find(b=>!row.state.blocks.some(old=>old.blockId===b.blockId))
    if(!proposal.newBlock)throw Error('ACP kernel produced no durable block')
    if(plain&&span.some(m=>!proposal.newBlock.effectiveMessageIds.includes(m.id)))
      throw Error('native ACP range contains protected messages excluded by the kernel')
    if(preview)return proposal
    queueAcpSummary(session,proposal,lease)
    this.pending.set(session,proposal)
    this.nudgeCache.delete(session)
    return {accepted:true,mode:'next-agent-step',startRef,endRef,
      block:proposal.newBlock.blockId,tier:proposal.newBlock.tier,
      advice:'Proposal is executed at the next safe DSH agent/pre-step; call acp_status to verify.'}
  }
  proposeBatch(session,args) {
    if(this.pending.has(session)||this.batches.has(session))throw Error('one ACP compression proposal is already queued')
    const parsed=parseCompressArgs(args)
    if(!parsed.ranges.length||parsed.ranges.length>8||parsed.diagnostics.invalidItems)
      throw Error('native ACP requires 1-8 valid ranges per batch')
    const selected=new Set()
    for(const range of parsed.ranges) {
      const proposal=this.propose(session,range,{preview:true})
      const nodes=session.surface.nodes
      for(const seq of nodes.slice(nodes.indexOf(Number(proposal.firstId)),nodes.indexOf(Number(proposal.lastId))+1)) {
        if(selected.has(seq))throw Error('native ACP batch ranges overlap')
        selected.add(seq)
      }
    }
    const accepted=this.propose(session,parsed.ranges[0])
    this.batches.set(session,parsed.ranges.slice(1))
    return {...accepted,batchQueued:parsed.ranges.length,transactionScope:'one-native-transaction-per-range'}
  }
  proposeAbsorb(session,{ref,summary}={}) {
    const {row,messages,config}=this.view(session)
    const raw=row.state.messageRefs.byRef[ref]
    const result=messages.find(m=>m.id===raw&&m.contentType==='tool-result')
    const calls=messages.filter(m=>m.contentType==='tool-call'&&m.toolCallId===result?.toolCallId)
    const results=messages.filter(m=>m.contentType==='tool-result'&&m.toolCallId===result?.toolCallId)
    if(!result||!result.toolCallId||calls.length!==1||results.length!==1
      ||messages.indexOf(result)!==messages.indexOf(calls[0])+1)
      throw Error('native absorb requires one complete unambiguous consecutive tool pair')
    const checked=applyAbsorb({ref,summary,messages,state:row.state,config:{...config,absorb:{...config.absorb,enabled:true}}})
    if(!checked.ok)throw Error(checked.resultText)
    // DSH expresses the upstream decision through its existing transaction.
    // Never persist absorbed state that would independently hide host messages.
    return this.propose(session,{startRef:row.state.messageRefs.byRaw[calls[0].id],endRef:ref,summary,topic:'Consumed tool result'})
  }
  async processPending(agent,compaction,signal) {
    const session=agent.session
    if(!this.pending.has(session))return null
    const lease=acquireAcpProcessing(session)
    if(!lease)return null
    try {
      const remaining=this.batches.get(session)??[]
      this.batches.delete(session)
      const first=await this.processOnePending(agent,compaction,signal,lease)
      if(!first)return null
      const committed=[first]
      for(const range of remaining) {
        signal?.throwIfAborted?.()
        this.propose(session,range,{lease})
        committed.push(await this.processOnePending(agent,compaction,signal,lease))
      }
      return committed.length===1?first:{batchCommitted:committed.length,latest:committed.at(-1)}
    } finally {
      releaseAcpProcessing(session,lease)
    }
  }
  async processOnePending(agent,compaction,signal,lease) {
    const session=agent.session
    const proposal=this.pending.get(session)
    if(!proposal)return null
    if(!ownsAcpProcessing(session,lease))throw Error('native ACP processing lease required')
    try {
      signal?.throwIfAborted?.()
      // Do not act on a changed context or stale ref mapping.
      const current=this.view(session)
      const start=Number(proposal.firstId),end=Number(proposal.lastId)
      const validate=()=>{
        signal?.throwIfAborted?.()
        if(session.surface.replaceGeneration!==proposal.surfaceGeneration
          ||stateRevision(session)!==proposal.stateRevision)
          throw Error('surface or ACP state changed since proposal')
        if(!session.surface.nodes.includes(start)||!session.surface.nodes.includes(end))
          throw Error('ACP proposal bounds are no longer visible')
      }
      validate()
      // Persist the EXACT proposed post-compaction kernel state *before*
      // the native engine can replace the visible DSH Surface.
      // On crash after native commit, recovery validates the DSH transaction
      // against this intent. Missing durability listener is fail-closed.
      this.appendRecord(session,INTENT_EVENT,durableJson({
        version:1,state:proposal.nextState,blockId:proposal.newBlock.blockId,
        summary:proposal.summary,startSeq:start,endSeq:end,
        checkpoints:current.row.checkpoints,
      }))
      if(this.flushIntent){
        const persisted=await this.flushIntent(session)
        if(persisted!==true)throw Error('native ACP intent lacks durable persistence listener')
      }
      // Native pressure/overflow has its own lock and may run during the flush.
      validate()
      const result=await withAcpSummary(session,proposal,
        ()=>compaction.compactRegion(start,end,agent,signal))
      const nextState=proposal.nextState
      const currentCheckpoints={...current.row.checkpoints}
      const checkpoint=session.snapshotEvents().find(e=>e.type==='user/message'
        &&e.data?.source?.kind==='compact-checkpoint'
        &&e.data?.source?.compactionId===result.compactionId)
      if(!checkpoint)throw Error('native ACP checkpoint missing after compaction')
      currentCheckpoints[String(checkpoint.seq)]=proposal.newBlock.blockId
      const lastResult={block:proposal.newBlock.blockId,summarySeq:result.summarySeq,
        compactionId:result.compactionId}
      // The state commit is a DSH-native, ignorable, fork/replay-safe log
      // record. On a crash before this append, native compaction originals
      // remain recoverable and the adapter will not invent a recovered block.
      this.appendRecord(session,STATE_EVENT,durableJson({
        version:1,state:nextState,checkpoints:currentCheckpoints,lastResult,
      }))
      // ACK is not durable until the native Session Store confirms its
      // persistence hooks have settled. This flush covers the prior native
      // compaction transaction AND our ACP state plugin record.
      if(this.flushIntent){
        const persisted=await this.flushIntent(session)
        if(persisted!==true)throw Error('native ACP state commit lacks durable persistence listener')
      }
      current.row.state=nextState
      current.row.checkpoints=currentCheckpoints
      current.row.settled=lastResult
      current.row.recovered=false
      delete current.row.projected
      return lastResult
    } catch(error) {
      this.logger?.warn?.('native ACP proposal refused: '+String(error?.message??error))
      throw error
    } finally {
      this.pending.delete(session)
      clearQueuedAcpSummary(session,proposal)
      this.nudgeCache.delete(session)
    }
  }
  search(session,query,{algorithm='hybrid'}={}) {
    if(typeof query!=='string'||query.length<2||query.length>160)
      throw Error('query must be 2–160 characters')
    const {row}=this.view(session)
    if(typeof algorithm!=='string'||!getSearchAlgorithm(algorithm))throw Error('unknown upstream search algorithm')
    const active=row.state.blocks.filter(b=>b.active)
    const ranked=searchBlocks(blockDocs({...row.state,blocks:active}),query,{algorithm,limit:10})
    return ranked.map(hit=>({...fullSummaryBlock(active.find(b=>b.blockId===hit.blockId)),score:hit.score}))
  }
  /**
   * Lossless bounded paging over the ORIGINAL native Session event, not a
   * second copy or ACP's shortened in-memory projection. Only source events
   * already covered by an active ACP Block are accessible.
   */
  retrieve(session,{blockId,ref,startIndex=0,offset=0,limit=4096}={}) {
    if(!BLOCK.test(blockId))throw Error('invalid ACP block id')
    if(!Number.isSafeInteger(startIndex)||startIndex<0||startIndex>100000
       ||!Number.isSafeInteger(offset)||offset<0||offset>100000000
       ||!Number.isSafeInteger(limit)||limit<1||limit>8192)
      throw Error('invalid ACP original retrieval bounds')
    const {row}=this.view(session)
    const block=row.state.blocks.find(b=>b.blockId===blockId&&b.active)
    if(!block)throw Error('unknown or inactive ACP block')
    const originals=block.effectiveMessageIds
      .filter(id=>typeof id==='string'&&/^\d+$/.test(id))
      .filter((id,i,arr)=>arr.indexOf(id)===i)
    const isSource=ev=>['user/message','assistant/message','tool/result'].includes(ev?.type)
    if(ref===undefined) {
      const selected=originals.slice(startIndex,startIndex+24).map(id=>{
        const ev=session.eventAt(Number(id))
        const m=ev?.type==='user/message'?ev.data:ev?.data?.message
        const allowed=isSource(ev)&&Array.isArray(m?.content)
        const length=allowed ? m.content.filter(c=>c?.type==='text'&&typeof c.text==='string')
          .reduce((n,c,i)=>n+c.text.length+(i?1:0),0):0
        return {ref:row.state.messageRefs.byRaw[id]??null,type:ev?.type??'missing',
          characters:length,available:allowed}
      })
      return {blockId,sourceCount:originals.length,sources:selected,
        nextIndex:startIndex+24<originals.length?startIndex+24:null}
    }
    if(!REF.test(ref))throw Error('invalid ACP original message ref')
    const raw=row.state.messageRefs.byRef[ref]
    if(!raw||!originals.includes(raw))throw Error('message ref is not covered by the requested active ACP block')
    const ev=session.eventAt(Number(raw))
    if(!isSource(ev))throw Error('original source event is unavailable')
    const m=ev.type==='user/message'?ev.data:ev.data?.message
    if(!Array.isArray(m?.content))throw Error('original message content is unavailable')
    const chunks=m.content.filter(c=>c?.type==='text'&&typeof c.text==='string').map(c=>c.text)
    let fullLength=0;let result=''
    for(let i=0;i<chunks.length;i++) {
      const part=(i?'\n':'')+chunks[i]
      const from=Math.max(0,offset-fullLength)
      const to=Math.min(part.length,offset+limit-fullLength)
      if(to>from)result+=part.slice(from,to)
      fullLength+=part.length
    }
    return {blockId,ref,offset,nextOffset:offset+result.length<fullLength?offset+result.length:null,
      characters:fullLength,text:result,truncated:offset+result.length<fullLength}
  }
  decompress(session,blockId) {
    if(!BLOCK.test(blockId))throw Error('invalid ACP block id')
    const {row}=this.view(session)
    const block=this.core.decompress(blockId,row.state)
    if(!block)throw Error('unknown ACP block')
    // Non-mutating retrieval: native Session continues using the summary.
    // The original text comes from DSH's append-only event log, not a proxy.
    const original=collectBlockContent(row.state,block,historicMessages(session),{full:true})
    return {id:blockId,tier:block.tier,summary:block.summary.slice(0,1500),
      originalCount:original.count,original:original.text.slice(0,MAX_ORIGINAL),
      truncated:original.text.length>MAX_ORIGINAL,cacheSafe:true}
  }
}
