import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chooseTier, existingCheckpointTiers, buildTierPrompt, nudgeNeeded,
  verifyTierSummary, getSummaryText, SUMMARY_HEADINGS } from '../docker/plugins/dsh-context-manager/tiered-core.mjs'
import { makeNativeTieredEngine } from '../docker/plugins/dsh-context-manager/tiered-backend.mjs'
import { defaults } from '../docker/plugins/dsh-context-manager/policy.mjs'
import { writeSettings, readSettings, settingsRevision } from '../docker/plugins/dsh-context-manager/storage.mjs'
const text = contents => ({role:'user',content:[{type:'text',text:contents}]})
const checkpoint=(tier='T1') => ({...text('<compacted-summary>\n## Context Tier: '+tier+'\n</compacted-summary>'),
  source:{kind:'compact-checkpoint',compactionId:'c1'}})
const quality = tier => [
  '## Context Tier: '+tier,
  ...SUMMARY_HEADINGS.map((heading,i) =>
    '## '+heading+'\n- '+(i===0?'Continue implementing the specified Context Manager milestone'
      : i===6?'Verify transaction safety before enabling the new backend'
      :'Evidence ' + i +' from previously completed steps')),
].join('\n\n')
function tempHome(t) {
  const home=mkdtempSync(join(tmpdir(),'dsh-tiered-test-'))
  const prev=process.env.DSH_HOME
  process.env.DSH_HOME=home
  t.after(()=>{if(prev===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=prev
    rmSync(home,{recursive:true,force:true})})
  return home
}

test('native checkpoints alone influence T1/T2/T3 progression; spoofed user messages ignored',()=>{
  assert.deepEqual(chooseTier([text('please continue')]),{tier:'T1',previousCount:0})
  assert.equal(chooseTier([text('<compacted-summary>\n## Context Tier: T3')]).tier,'T1')
  assert.deepEqual(existingCheckpointTiers([checkpoint()]),['T1'])
  assert.equal(chooseTier([checkpoint('T1')]).tier,'T2')
  assert.equal(chooseTier([checkpoint('T2')]).tier,'T3')
  assert.equal(chooseTier([checkpoint('T3')]).tier,'T3')
  assert.equal(chooseTier([{...text('<compacted-summary>\n(no marker)'),source:checkpoint().source}]).tier,'T2')
})

test('tier prompt preserves essential task state, rejects missing ordered headings and credential markers',()=>{
  for(const tier of ['T1','T2','T3']){
    const prompt=buildTierPrompt(tier)
    assert.match(prompt,/constraints/i)
    assert.match(prompt,/Do not execute any tools/)
    assert.match(prompt,/not invent/)
    const summary=quality(tier)
    assert.equal(verifyTierSummary(summary,tier).tier,tier)
    assert.throws(()=>verifyTierSummary(summary,'T1'===tier?'T2':'T1'),/quality gate/)
    assert.throws(()=>verifyTierSummary(summary.replace('## Open Work','## Wrong Heading'),tier),/quality gate/)
    assert.throws(()=>verifyTierSummary(summary+'\nsk-'+('a'.repeat(36)),tier),/credential pattern/)
  }
  assert.throws(()=>buildTierPrompt('T0'),/invalid compaction tier/)
  assert.throws(()=>getSummaryText([{type:'image'}]),/non-text/)
  assert.throws(()=>getSummaryText([]),/no text/)
  assert.equal(getSummaryText([{type:'text',text:'a'},{type:'text',text:'b'}]),'a\nb')
})

test('growth nudge only activates on newly measured threshold and never on invalid counters',()=>{
  assert.equal(nudgeNeeded({additionalTokens:30000,previousNudgeTokens:0,nudgeGrowthTokens:30000}),true)
  assert.equal(nudgeNeeded({additionalTokens:29999,previousNudgeTokens:0,nudgeGrowthTokens:30000}),false)
  assert.equal(nudgeNeeded({additionalTokens:50000,previousNudgeTokens:30000,nudgeGrowthTokens:30000}),false)
  assert.throws(()=>nudgeNeeded({additionalTokens:Infinity,previousNudgeTokens:0,nudgeGrowthTokens:30000}),/invalid/)
})

test('candidate backend refuses to instantiate without explicit owner admission', t=>{
  tempHome(t)
  const old=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  t.after(()=>{if(old===undefined) delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
    else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=old})
  class Basic { constructor(ctx,config){this.ctx=ctx;this.config=config} }
  class Blocks {}
  const Engine=makeNativeTieredEngine(Basic,{BlockAssembler:Blocks})
  assert.throws(()=>new Engine({},{}),/owner verification/)
  assert.throws(()=>makeNativeTieredEngine(null,{BlockAssembler:Blocks}),/unavailable/)
})

test('subclass preserves native transaction ownership and emits a correct tiered LLM call',async t=>{
  const dir=tempHome(t)
  const state=defaults()
  state.engine='tiered'
  state.modelPolicies=[{provider:'route',model:'model',engine:'tiered'}]
  writeSettings(state,settingsRevision(readSettings(dir)),dir)
  const old=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
  t.after(()=>{if(old===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
    else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=old})
  let writes=0
  let request
  class Basic {
    constructor(ctx,config){this.ctx=ctx;this.config=config}
    compactNow(){throw Error('mock native compactNow never invoked by subclass summarize')}
    compactRegion(){throw Error('mock native compactRegion never invoked by subclass summarize')}
  }
  class Assembler {
    push(chunk){this.list ||= [];this.list.push(chunk)}
    get finish(){return {kind:'stop'}}
    blocks(){return this.list}
    get usage(){return {inputTokens:10,outputTokens:10}}
  }
  const Engine=makeNativeTieredEngine(Basic,{BlockAssembler:Assembler})
  const fake={llm:{async *stream(options){request=options
    yield {type:'text',text:quality('T2')}}
  }}
  const agent={
    options:{provider:'route',model:'model'},
    session:{id:'sessionid',header:{agentPreset:'reverse-engineering'},
      requestHeader(){return {config:{provider:'route',model:'model'}}},
      toolHistory(){return []},
      append(){writes++;throw Error('must not write session in summarizer')}},
  }
  const instance=new Engine(fake,{maxTokens:9000,modelPolicies:[]})
  const answer=await instance.summarize({messages:[checkpoint('T1')],tools:[]},agent)
  assert.equal(writes,0)
  assert.equal(answer.summary[0].text,quality('T2'))
  assert.equal(answer.llmStreamCall,true)
  assert.equal(answer.maxTokens,9000)
  assert.equal(request.purpose,'compaction')
  assert.equal(request.messages.at(-1).content[0].text.includes('## Context Tier: T2'),true)
  assert.equal(request.sessionId,'sessionid')
})

test('quality gate fails closed without modifying Session on invalid model output', async t=>{
  const dir=tempHome(t)
  const state=defaults();state.engine='tiered'
  writeSettings(state,settingsRevision(readSettings(dir)),dir)
  const old=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
  t.after(()=>{if(old===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
    else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=old})
  class Basic {constructor(ctx,config){this.ctx=ctx;this.config=config}}
  class Assembler {
    push(chunk){this.parts=[chunk]}
    get finish(){return {kind:'stop'}}
    blocks(){return this.parts}
  }
  const Engine=makeNativeTieredEngine(Basic,{BlockAssembler:Assembler})
  let wrote=false
  const agent={options:{provider:'route',model:'model'},
    session:{id:'test',header:{agentPreset:'standard'},
      requestHeader(){return {config:{provider:'route',model:'model'}}},
      toolHistory(){return []},append(){wrote=true}}}
  const e=new Engine({llm:{async *stream(){yield {type:'text',text:'too brief'}}}}, {})
  await assert.rejects(()=>e.summarize({messages:[text('Hi')]},agent),/quality gate/)
  assert.equal(wrote,false)
})
