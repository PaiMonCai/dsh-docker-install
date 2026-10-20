/**
 * Docker build integration: REAL installed DSH Session, LLM runtime adapter,
 * TokenMeter, BasicCompactionEngine subclass and compactNow transaction.
 * Only the MODEL response is deterministic; no API credentials or gateway.
 * Unlike Phase 6's command-handler mock this executes native compaction.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { SUMMARY_HEADINGS } from '/opt/dsh/plugins/dsh-context-manager/tiered-core.mjs'
import { defaults } from '/opt/dsh/plugins/dsh-context-manager/policy.mjs'
import { readSettings, writeSettings, settingsRevision } from '/opt/dsh/plugins/dsh-context-manager/storage.mjs'
import { indexCompactions, originalPage } from '/opt/dsh/plugins/dsh-context-manager/history-index.mjs'
const rq = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
async function load(pkg){
  return import(pathToFileURL(rq.resolve(pkg)).href)
}
const [{ Context },llmLib,sessionLib,projectionLib,tokenLib,tieredLib] = await Promise.all([
  load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-llm'),
  load('@deepseek-ai/dsh-session'),load('@deepseek-ai/dsh-session-projection'),
  load('@deepseek-ai/dsh-token-meter'),
  import('/opt/dsh/plugins/dsh-context-manager/tiered-native.js'),
])
const { LlmAdapter, createUserMessage, createAssistantMessage }=llmLib
const LlmRuntime=llmLib.default
const SessionStore=sessionLib.default
const SessionProjectionRegistry=projectionLib.default
const TokenMeter=tokenLib.default
const { Session, SessionId }=sessionLib
const TieredEngine=tieredLib.default
const sourceText='original evidence should survive successful compression; '.repeat(450)
const summaryFor=tier=>[
  '## Context Tier: '+tier,
  ...SUMMARY_HEADINGS.map((h,i)=>'## '+h+'\n- '+(
    i===0?'Keep the user requested agent migration and context management objective':
    i===5?'Open verification work includes external conflict detection and source recovery':
    'Preserve verified event evidence, service ownership constraints, and pending work item '+i)),
].join('\n\n')
class ControlledAdapter extends LlmAdapter {
  mode='success'
  calls=[]
  resolveModel(provider,model){
    return Promise.resolve({
      provider,id:model,name:model,context:{contextWindow:200000},
    })
  }
  async *stream(options){
    this.calls.push(options)
    if(this.mode==='throw')throw Error('synthetic model transport failure')
    const requestedTier=/## Context Tier: (T1|T2|T3)/.exec(
      options.messages.at(-1)?.content?.[0]?.text??'')?.[1]??'T1'
    const response=this.mode==='invalid'?'invalid tiny summary':summaryFor(requestedTier)
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'block-end',index:0,block:{type:'text',text:response}}
    yield {type:'finish',reason:{kind:'stop'}}
  }
}
function seed(id,turns=3) {
  const s=Session.create(SessionId(id))
  for(let turn=1;turn<=turns;turn++){
    s.append('turn/start',{turn})
    s.append('user/message',createUserMessage({
      content:[{type:'text',text:sourceText+' event turn='+turn}],
      source:{kind:'user'},
    }),{surfaceOp:'append'})
    s.append('step/start',{turn,step:1})
    if(turn===1)s.append('request/header',{
      header:{config:{provider:'mock',model:'mock'}},reason:'initial',
    })
    s.append('assistant/message',{
      stream:[],turn,step:1,message:createAssistantMessage({
        content:[{type:'text',text:'confirmed turn '+turn}],
        source:{provider:'mock',model:'mock'},
      }),
    },{surfaceOp:'append'})
    s.append('step/end',{turn,step:1})
    s.append('turn/end',{turn,reason:{kind:'completed'}})
  }
  return s
}
function fakeAgent(session){
  return {
    id:'isolated-native-agent',
    session,options:{provider:'mock',model:'mock'},
    runMaintenance(task){return task(new AbortController().signal)}
  }
}
const home=mkdtempSync(join(tmpdir(),'dsh-native-tiered-txn-'))
const oldHome=process.env.DSH_HOME
const oldGate=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
process.env.DSH_HOME=home
process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
try {
  const state=defaults();state.engine='tiered'
  writeSettings(state,settingsRevision(readSettings()))
  const ctx=new Context()
  new LlmRuntime(ctx)
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new TokenMeter(ctx)
  const adapter=new ControlledAdapter()
  ctx.llm.registerAdapter(['mock'],adapter)
  // A detached test Session has no persistent store backing. Native
  // compactNow still requires a durability callback; cold persistence has
  // been independently proven in the Phase-5 two-container CI.
  ctx.sessions.flush=async()=>false
  const engine=new TieredEngine(ctx,{auto:false,maxTokens:2048,headroomTokens:4096})
  const session=seed('native-tiered-success')
  const originalSnapshot=session.snapshotEvents()
  const result=await engine.compactNow(fakeAgent(session),
    new AbortController().signal,'synthetic-command-1')
  assert.ok(result?.summarySeq!==undefined,'native compactNow did not commit')
  assert.equal(adapter.calls.length,1,'expected one real DSH LLM adapter request')
  assert.equal(adapter.calls[0].purpose,'compaction')
  assert.match(result.summary[0].text,/## Context Tier: T1/)
  const index=indexCompactions({meta:{id:session.id},events:session.snapshotEvents()})
  assert.equal(index.total,1)
  assert.equal(index.incomplete,0)
  assert.equal(index.rows[0].compactionId,result.compactionId)
  const orig=originalPage({events:session.snapshotEvents()},index,{
    summarySeq:index.rows[0].summarySeq,revision:index.revision,limit:10,
  })
  assert.ok(orig.items.some(x=>x.text.includes('original evidence')))
  assert.ok(originalSnapshot.every(e=>session.snapshotEvents().some(now=>now.seq===e.seq)))
  // Independently replay every persisted event into the native Session
  // projection, matching the cold-read constructor's event validation.
  const restored=Session.create(session.id,session.snapshotEvents(),session.header)
  assert.deepEqual(restored.surface.nodes,session.surface.nodes)
  assert.equal(indexCompactions({meta:{id:restored.id},events:restored.snapshotEvents()}).total,1)
  const snap=session.snapshotEvents()
  assert.ok(snap.some(e=>e.type==='compaction/start'))
  assert.ok(snap.some(e=>e.type==='compaction/summary'))
  assert.ok(snap.some(e=>e.type==='compaction/end' && e.data.error===undefined))
  process.stdout.write('DSH_CONTEXT_MANAGER_NATIVE_TIERED_SUCCESS complete=true original-preserved=true\n')

  for(const mode of ['invalid','throw']){
    adapter.mode=mode
    const failed=seed('native-tiered-failure-'+mode)
    const startSurface=failed.surface.nodes.slice()
    const before=failed.snapshotEvents().length
    await assert.rejects(
      ()=>engine.compactNow(fakeAgent(failed),new AbortController().signal,'synthetic-failed-'+mode),
      /manual compaction|summary|could not produce/i)
    const after=failed.snapshotEvents()
    assert.deepEqual(failed.surface.nodes,startSurface)
    assert.equal(after.filter(x=>x.type==='compaction/start').length,1)
    assert.equal(after.filter(x=>x.type==='compaction/summary').length,0)
    assert.equal(after.filter(x=>x.type==='compaction/end' && x.data.error!==undefined).length,1)
    assert.equal(indexCompactions({meta:{id:failed.id},events:after}).total,0)
    assert.equal(indexCompactions({meta:{id:failed.id},events:after}).incomplete,1)
    assert.ok(after.length>before)
    const restoredFailed=Session.create(failed.id,after,failed.header)
    assert.deepEqual(restoredFailed.surface.nodes,startSurface)
    assert.equal(indexCompactions({meta:{id:failed.id},events:restoredFailed.snapshotEvents()}).total,0)
  }
  process.stdout.write('DSH_CONTEXT_MANAGER_NATIVE_TIERED_FAIL_CLOSED modes=invalid,transport\n')
} finally {
  if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
  if(oldGate===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=oldGate
  rmSync(home,{recursive:true,force:true})
}
