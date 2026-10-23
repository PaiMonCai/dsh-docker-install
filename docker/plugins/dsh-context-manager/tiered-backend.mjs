/**
 * Pluggable DSH BasicCompactionEngine subclass. No persistent Session writes
 * occur here: native compactRegion/compactNow drive their own lock, summarizer,
 * shrink validation and durable compaction/start/summary/end transaction.
 *
 * NOT added to any startup patch in Phase 3: owner gate is deliberately
 * explicit until native preset replacement and external bili interception are
 * individually demonstrated on disposable sessions.
 */
import { buildTierPrompt, chooseTier, getSummaryText, verifyTierSummary } from './tiered-core.mjs'
import { readSettings } from './storage.mjs'
import { resolvePolicy } from './policy.mjs'
import { currentAcpSummary, hasQueuedAcpSummary } from './acp-pending.mjs'
import { nativeBootSettings, sessionPreset } from './native-plugin.mjs'
import {createDiagnostics,diagnosticReason} from './diagnostics.mjs'

function targetFrom(agent) {
  const routed=agent?.session?.requestHeader?.()?.config
  if (routed?.provider && routed?.model) return {provider:routed.provider,model:routed.model}
  if (agent?.options?.provider && agent?.options?.model)
    return {provider:agent.options.provider,model:agent.options.model}
  throw Error('tiered summarization requires a routed provider/model')
}
function scopeFrom(agent, target) {
  return {agentId:sessionPreset(agent?.session), provider:target.provider,model:target.model}
}
function stageTarget(config, target) {
  const exact=config?.modelPolicies?.find(p=>p.provider===target.provider && p.model===target.model)
  const src = exact ?? config
  const explicit=(src?.summarizationProvider && src?.summarizationModel) ? {
    provider:src.summarizationProvider,model:src.summarizationModel,
  } : null
  return { ...(explicit ?? target), maxTokens:src?.maxTokens ?? config?.maxTokens ?? 65536 }
}
function assertFinish(finish) {
  if (finish?.kind==='error' || finish?.kind==='aborted')
    throw Error('tiered summarization request failed')
  if (finish?.kind==='max-tokens')
    throw Error('tiered summarization was truncated at token cap')
}
export function makeNativeTieredEngine(BasicEngine, {BlockAssembler}) {
  if (typeof BasicEngine!=='function' || typeof BlockAssembler!=='function')
    throw Error('native DSH compaction and LLM assembler unavailable')
  return class DshTieredCompactionEngine extends BasicEngine {
    constructor(ctx, config={}) {
      const nativePolicy = nativeBootSettings()
      if (!nativePolicy && process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED!=='1')
        throw Error('tiered backend requires explicit owner verification; not enabled')
      super(ctx,config)
      this.nativePolicy = nativePolicy
      this.log=createDiagnostics(ctx.logger)
      this.log('engine.mounted',{mode:nativePolicy?'builtin':'lab'})
    }
    // Preserve the upstream pressure and context-overflow recovery state
    // machine. A model-authored ACP proposal owns the NEXT safe step; skip
    // only the automatic pressure branch while that proposal is queued.
    // Never suppress context-overflow recovery (it may rescue a failed model
    // response independently). No second CompactionEngine is registered.
    async compactIfNeeded(agent,trigger,signal) {
      this.log('engine.trigger',{session:agent?.session,preset:sessionPreset(agent?.session),trigger})
      if(trigger==='pressure' && hasQueuedAcpSummary(agent?.session)) {
        this.log('engine.deferred',{session:agent?.session,trigger})
        return null
      }
      return super.compactIfNeeded(agent,trigger,signal)
    }
    async summarize(input, agent, signal) {
      signal?.throwIfAborted?.()
      const target=targetFrom(agent)
      const proposal=currentAcpSummary(agent.session)
      if(proposal) return { summary:[{type:'text',text:proposal.summary}],
        provider:target.provider,model:target.model }
      const policy=resolvePolicy(this.nativePolicy ?? readSettings(),scopeFrom(agent,target))
      if (policy.engine!=='tiered') return super.summarize(input,agent,signal)
      const started=performance.now()
      try { return await this.summarizeTiered(input,agent,signal,policy,target) }
      catch (error) {
        if(signal?.aborted) {
          this.log('summary.cancelled',{session:agent.session,reason:'cancelled',elapsedMs:performance.now()-started})
          signal.throwIfAborted()
        }
        if (!this.nativePolicy) throw error
        this.log('summary.fallback',{session:agent.session,reason:diagnosticReason(error),elapsedMs:performance.now()-started})
        return super.summarize(input,agent,signal)
      }
    }
    async summarizeTiered(input,agent,signal,policy,target) {
      const checkpointRows=agent.session?.surface?.nodes
        ?.map(seq=>agent.session.eventAt(seq)?.data)
        .filter(row=>row?.source?.kind==='compact-checkpoint') ?? []
      const stage=chooseTier(agent.session?.surface?.nodes ? checkpointRows : input?.messages)
      if (this.nativePolicy && !policy.tiered.tiers) stage.tier='T1'
      const route=stageTarget(this.config,target)
      const started=performance.now()
      this.log('summary.started',{session:agent.session,provider:route.provider,model:route.model,tier:Number(stage.tier.slice(1))})
      const options={
        provider:route.provider,model:route.model,
        messages:[...(input?.messages ?? []), {role:'user',content:[{
          type:'text',text:buildTierPrompt(stage.tier),
        }]}],
        ...(input?.tools===undefined ? {} : {tools:[...input.tools]}),
        toolHistory:agent.session.toolHistory(),
        maxTokens:route.maxTokens,sessionId:agent.session.id,
        purpose:'compaction', ...(signal===undefined ? {} : {signal}),
      }
      const assembled=new BlockAssembler()
      for await(const chunk of this.ctx.llm.stream(options)) {
        signal?.throwIfAborted?.()
        assembled.push(chunk)
      }
      assertFinish(assembled.finish)
      const rawOutput=assembled.blocks()
      const summaryText=getSummaryText(rawOutput)
      verifyTierSummary(summaryText, stage.tier)
      const summary=[{type:'text',text:summaryText.trim()}]
      this.log('summary.completed',{session:agent.session,provider:route.provider,model:route.model,
        tier:Number(stage.tier.slice(1)),summaryChars:summaryText.trim().length,elapsedMs:performance.now()-started})
      return {
        summary,rawOutput,llmStreamCall:true,
        provider:options.provider,model:options.model,maxTokens:options.maxTokens,
        ...(assembled.usage===undefined?{}:{usage:assembled.usage}),
      }
    }
  }
}
