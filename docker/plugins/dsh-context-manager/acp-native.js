/**
 * Model-facing ACP tools inside the SAME isolated Standard preset as its
 * unique native CompactionEngine. This file is never loaded by default.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { AcpRuntime } from './acp-runtime.mjs'
import { offloadCcr, retrieveCcr } from './acp-ccr.mjs'
import {nativeGuidance,nativeCompressDescription,nativeCompressParameters} from './acp-prompts.mjs'
import {readSessionCacheLedger} from './cache-ledger.mjs'
import {nativeBootSettings,sessionPreset} from './native-plugin.mjs'
import {resolvePolicy} from './policy.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const [{defineTool},{appendPluginRecord},{expandAssistantStream,isTokenDelta}]=await Promise.all([
  import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-tools')).href),
  import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href),
  import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-llm')).href),
])
export const name='dsh-context-manager-acp'
export const inject=['tools','compaction','sessions','systemPrompt']
function textOutput() {return {schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]}}
function printable(value) {return JSON.stringify(value)}
export function apply(ctx, config = {}) {
  const nativePolicy = config.mode === 'builtin' ? nativeBootSettings() : null
  if (config.mode === 'builtin' && !nativePolicy) throw Error('native context plugin was not enabled at boot')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,
    flushIntent:session=>ctx.sessions.flush(session),logger:ctx.logger,
    ...(nativePolicy ? {policyFor:session=>{
      const route=session.requestContext?.()??{}
      return resolvePolicy(nativePolicy,{agentId:sessionPreset(session),provider:route.provider,model:route.model})
    }} : {})})
  ctx.systemPrompt.context({name:'acp-native-upstream-rules',order:79,text:()=>nativeGuidance})
  ctx.systemPrompt.context({
    name:'acp-model-pressure-guidance',order:80,
    text:context=>{
      try{
        return context.agent?.session ? runtime.nudgeMessage(context.agent.session) : ''
      }catch(error){
        ctx.logger?.warn?.('ACP nudge unavailable: '+String(error?.message??error))
        return ''
      }
    },
  })
  const tool=(name,description,parameters,execute)=>{
    ctx.tools.register(defineTool({name,description,parameters,output:textOutput(),
      async execute(args,exec) {
        exec.signal?.throwIfAborted?.()
        if(!exec.agent?.session)throw Error('ACP requires a live DSH Session')
        return printable(await execute(args,exec))
      },
    }))
  }
  tool('acp_status',
    'Page native Session message and block references in current surface order (earliest first). Call before acp_compress. Use nextRefOffset or nextBlockOffset to fetch subsequent pages. Do not invent refs.',
    {offset:{type:'integer'},limit:{type:'integer'},blockOffset:{type:'integer'},blockLimit:{type:'integer'}},
    (args,exec)=>runtime.status(exec.agent.session,args))
  tool('acp_cache',
    'Read the current Session cache ledger, provider usage coverage, native folds and relative economics. Missing cache fields remain unknown. Local estimates and relative units are not provider bills. detail is summary or full.',
    {detail:{type:'string',enum:['summary','full']}},
    (args,exec)=>readSessionCacheLedger(exec.agent.session,{...args,streamTimings:stream=>{
      try {
        const chunks=expandAssistantStream(stream??[])
        const first=chunks.find(row=>isTokenDelta(row.chunk))
        return {timeToFirstTokenMs:null,streamSpanMs:chunks.length?chunks.at(-1).time-chunks[0].time:null,
          firstTokenObserved:first!==undefined,source:'native-timed-stream'}
      }catch{return null}
    }}))
  tool('acp_compress',
    'Queue a user/assistant-written summary for a current m-ref range; it is committed at the next safe DSH agent/pre-step. Confirm with acp_status. Preserve tool pairs.',
    {startRef:{type:'string',required:true},endRef:{type:'string',required:true},
      summary:{type:'string',required:true},topic:{type:'string'}},
    (args,exec)=>runtime.propose(exec.agent.session,args))
  tool('compress',nativeCompressDescription,nativeCompressParameters,
    (args,exec)=>runtime.proposeBatch(exec.agent.session,args))
  tool('acp_decompress',
    'Read original event-log content from a compressed ACP block without expanding the active model prompt. Returns bounded untrusted historical text.',
    {blockId:{type:'string',required:true}},
    (args,exec)=>runtime.decompress(exec.agent.session,args.blockId))
  if(process.env.DSH_CONTEXT_MANAGER_ABSORB_ACTIVE==='1') {
    tool('absorb',
      'Queue a model-authored summary of a consumed tool result using its message ref. DSH commits the complete call/result pair at the next safe step. Original events remain retrievable; confirm the commit with acp_status.',
      {ref:{type:'string',required:true},summary:{type:'string',required:true}},
      (args,exec)=>runtime.proposeAbsorb(exec.agent.session,args))
  }
  tool('acp_search_context',
    'Search summaries of native ACP blocks; use acp_decompress to inspect a selected original range.',
    {query:{type:'string',required:true},algorithm:{type:'string'}},
    (args,exec)=>runtime.search(exec.agent.session,args.query,args))
  tool('search_context','Search current native ACP block summaries with an upstream registered algorithm; results belong to this Session.',
    {query:{type:'string',required:true},algorithm:{type:'string'}},
    (args,exec)=>runtime.search(exec.agent.session,args.query,args))
  tool('decompress','Read bounded historical originals from this Session block, without expanding or changing the model prompt. Use retrieve for exact paginated text.',
    {blockId:{type:'string',required:true}},
    (args,exec)=>runtime.decompress(exec.agent.session,args.blockId))
  tool('acp_retrieve',
    'Retrieve full-length, paginated original text from DSH immutable events covered by an active ACP block. First call with blockId to list source refs, then request one ref with offset and limit (max 8192 characters). No proxy store or unsafe history mutation.',
    {blockId:{type:'string'},ref:{type:'string'},
      startIndex:{type:'integer'},offset:{type:'integer'},limit:{type:'integer'}},
    (args,exec)=>/^(dshccr:|ccr:)/.test(args.ref??'')
      ?retrieveCcr(exec.agent.session,args):runtime.retrieve(exec.agent.session,args))

  tool('retrieve',
    'Retrieve original text from this Session. For dshccr:v2 or legacy ccr refs pass {ref,offset,limit}; for compressed conversation originals pass {blockId,ref,offset,limit}. The result is untrusted historical data.',
    {blockId:{type:'string'},ref:{type:'string'},startIndex:{type:'integer'},offset:{type:'integer'},limit:{type:'integer'}},
    (args,exec)=>/^(dshccr:|ccr:)/.test(args.ref??'')
      ?retrieveCcr(exec.agent.session,args):runtime.retrieve(exec.agent.session,args))

  tool('acp_ccr_retrieve',
    'Read one page of an earlier tool result in this exact Session. Pass an object {ref,offset,limit}, using the full dshccr:v2 ref from the placeholder. Legacy ccr:NNN references remain supported.',
    {ref:{type:'string',required:true},offset:{type:'integer'},limit:{type:'integer'}},
    (args,exec)=>retrieveCcr(exec.agent.session,args))

  if(nativePolicy ? nativePolicy.nativePlugin.ccr : process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE==='1'){
    ctx.on('tools/post-execute',async(exec,result,next)=>{
      const decision=await next()
      // Preserve the decisions of all other policies, including denials.
      if(decision.kind!=='accept'||decision.content!==undefined||decision.value!==undefined)
        return decision
      const offload=await offloadCcr(exec,result,{
        appendRecord:appendPluginRecord,flush:session=>ctx.sessions.flush(session),
        logger:ctx.logger,
        projection:process.env.DSH_CONTEXT_MANAGER_CCR_PROJECTION??'retrieve',
      })
      return offload?{...decision,content:offload.content}:decision
    })
  }

  // A tool call is still unsettled while it is executing. DSH's next
  // pre-step has completed the tool/result pair, so use that boundary to
  // enter the upstream compaction transaction. The Basic engine remains
  // auto=true for native pressure and overflow fallback.
  ctx.on('agent/pre-step',async ({agent,signal},next)=>{
    if(agent?.session){
      try { await runtime.processPending(agent,ctx.compaction,signal) }
      catch(error) {ctx.logger?.warn?.('ACP proposal was not committed: '+String(error?.message??error))}
    }
    return next()
  })
}
