/**
 * Native DSH ↔ acp-kernel adapter. Kernel output never directly mutates DSH's
 * immutable Session surface. All actual reductions run through ctx.compaction.
 * The original event log remains the only source of conversation truth.
 */
import {
  createCore, createInitialState, defaultConfig, collectBlockContent, summaryMessageId,
} from 'acp-kernel'
import { withAcpSummary } from './acp-pending.mjs'

export const STATE_EVENT = 'plugin:dsh-docker-context-manager/acp-state'
const MAX_VIEW = 1600
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
  const text = textOf(message.content, isHistoric ? MAX_ORIGINAL : MAX_VIEW)
  // Stable raw identity, never content-hash-based; seq is immutable under
  // replacements, even when visible surface order no longer follows seq.
  return { id: String(event.seq), role,
    contentType: role === 'tool' ? 'tool-result' : 'text',
    text: text || '[non-text or empty message]' }
}
function activeMessages(session, checkpoints) {
  return session.surface.nodes.map(seq => {
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
}
function historicMessages(session) {
  return session.snapshotEvents().map(ev => asMessage(ev, true)).filter(Boolean)
}
function recordFrom(session) {
  // Restore the last complete, ignorable plugin record. No side channel to an
  // unversioned JSON file; cold restore and fork replay naturally carry records.
  const events = session.snapshotEvents()
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type !== STATE_EVENT) continue
    if (ev.ignorable !== true || ev.data?.version !== 1 || !ev.data?.state?.messageRefs)
      throw Error('ACP state record invalid; refusing to silently reset compressed history')
    return ev.data
  }
  return null
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
  constructor({ appendRecord, logger } = {}) {
    if (typeof appendRecord !== 'function') throw Error('native appendPluginRecord required')
    this.appendRecord = appendRecord
    this.logger = logger
    this.core = createCore()
    this.cache = new WeakMap()
    this.pending = new WeakMap()
    this.processing = new WeakSet()
  }
  view(session) {
    let row = this.cache.get(session)
    if (!row) {
      const stored = recordFrom(session)
      row = {
        state: stored?.state ?? createInitialState(),
        checkpoints: stored?.checkpoints ?? {},
        settled: stored?.lastResult ?? null,
      }
      this.cache.set(session,row)
    }
    const messages = activeMessages(session,row.checkpoints)
    const config = configFor(session)
    const tokenCount = messages.reduce((total,m)=>total + Math.ceil(m.text.length/4),0)
    const projected = this.core.processTurn({
      messages,state:row.state,config,tokenCount,renderTags:'none',
    })
    row.state = projected.state
    return {row,messages,config,tokenCount,nudge:projected.nudge}
  }
  status(session) {
    const {row,messages,config,tokenCount,nudge} = this.view(session)
    const refs = messages.filter(m=>row.state.messageRefs.byRaw[m.id]?.startsWith('m'))
      .slice(-MAX_ITEMS).map(m=>({
        ref:row.state.messageRefs.byRaw[m.id],role:m.role,chars:m.text.length,
        // Deliberately omit prompt and tool-result content from a status report.
      }))
    return {kernel:'acp-kernel',surface:'dsh-native',owner:'agent-preset',
      tokenEstimate:tokenCount,window:config.modelContextLimit,
      pending:!!this.pending.get(session),nudgeRecommended:!!nudge?.shouldInject,
      blocks:row.state.blocks.filter(b=>b.active).slice(-MAX_ITEMS).map(fullSummaryBlock),
      refs,latest:row.settled}
  }
  propose(session,{startRef,endRef,summary,topic}) {
    if (this.pending.has(session)) throw Error('one ACP compression proposal is already queued')
    if (!REF.test(startRef)||!REF.test(endRef)) throw Error('ACP native pilot accepts current mNNNNN message refs only')
    if (typeof summary!=='string'||summary.trim().length<80||summary.length>MAX_SUMMARY)
      throw Error('summary must be 80–12000 characters')
    if (topic!==undefined && (typeof topic!=='string'||topic.length>128))
      throw Error('invalid topic')
    const view = this.view(session)
    const {row,messages,config} = view
    const refMap=row.state.messageRefs.byRef
    const first=messages.findIndex(m=>m.id===refMap[startRef])
    const last=messages.findIndex(m=>m.id===refMap[endRef])
    if(first<0||last<0||first>=last)throw Error('range must be a current ordered visible span of at least two messages')
    // Do not consume the trailing context. DSH's native boundary validator
    // independently protects unmatched tool call/result pairs at commit time.
    if(last>=messages.length-2)throw Error('preserve at least two recent surface messages')
    const proposal={startRef,endRef,summary:summary.trim(),topic:topic??null,
      firstId:messages[first].id,lastId:messages[last].id,
      surfaceGeneration:session.surface.replaceGeneration}
    const draft=this.core.applyCompression({ranges:[{
      startRef,endRef,summary:proposal.summary,
      ...(topic===undefined?{}:{topic}),
    }],messages,state:row.state,config})
    if(draft.result.blocksCreated!==1||draft.result.errors?.length)
      throw Error('ACP kernel rejected range: '+(draft.result.errors??[]).join('; ').slice(0,250))
    proposal.nextState=draft.state
    proposal.newBlock=draft.state.blocks.find(b=>!row.state.blocks.some(old=>old.blockId===b.blockId))
    if(!proposal.newBlock)throw Error('ACP kernel produced no durable block')
    this.pending.set(session,proposal)
    return {accepted:true,mode:'next-agent-step',startRef,endRef,
      block:proposal.newBlock.blockId,advice:'Proposal is executed at the next safe DSH agent/pre-step; call acp_status to verify.'}
  }
  async processPending(agent,compaction,signal) {
    const session=agent.session
    const proposal=this.pending.get(session)
    if(!proposal || this.processing.has(session))return null
    this.processing.add(session)
    try {
      signal?.throwIfAborted?.()
      // Do not act on a changed context or stale ref mapping.
      const current=this.view(session)
      if(session.surface.replaceGeneration!==proposal.surfaceGeneration)
        throw Error('surface changed since ACP proposal')
      const start=Number(proposal.firstId),end=Number(proposal.lastId)
      if(!session.surface.nodes.includes(start)||!session.surface.nodes.includes(end))
        throw Error('ACP proposal bounds are no longer visible')
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
      current.row.state=nextState
      current.row.checkpoints=currentCheckpoints
      current.row.settled=lastResult
      return lastResult
    } catch(error) {
      this.logger?.warn?.('native ACP proposal refused: '+String(error?.message??error))
      throw error
    } finally {
      this.pending.delete(session)
      this.processing.delete(session)
    }
  }
  search(session,query) {
    if(typeof query!=='string'||query.length<2||query.length>160)
      throw Error('query must be 2–160 characters')
    const {row}=this.view(session)
    const ranked=this.core.search(query,row.state)
    // Kernel's weighted relevance gate deliberately needs >0.1 score;
    // short blocks with one or two exact term matches can score 0.04–0.08.
    // Preserve exact-match findability without weakening the kernel's ranking
    // logic or returning unrelated/hidden content.
    const seen=new Set(ranked.map(b=>b.blockId))
    const needle=query.toLocaleLowerCase()
    const exact=row.state.blocks.filter(b=>b.active&&!seen.has(b.blockId)
      && ((b.summary??'').toLocaleLowerCase().includes(needle)
        || (b.topic??'').toLocaleLowerCase().includes(needle)))
    return [...ranked,...exact].slice(0,10).map(fullSummaryBlock)
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
