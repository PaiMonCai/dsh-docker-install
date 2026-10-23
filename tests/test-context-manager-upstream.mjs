import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Session, SessionId, appendPluginRecord } from '../ci/acp-kernel-audit/compatibility.mjs'
import { AcpRuntime,INTENT_EVENT,STATE_EVENT } from '../docker/plugins/dsh-context-manager/acp-runtime.mjs'
import { offloadCcr,retrieveCcr,CCR_EVENT } from '../docker/plugins/dsh-context-manager/acp-ccr.mjs'
import { buildStoredPlaceholder } from '../docker/plugins/dsh-context-manager/node_modules/acp-kernel/dist/index.js'
import { renderNudgeText,searchBlocks,blockDocs } from '../docker/plugins/dsh-context-manager/node_modules/acp-kernel/dist/index.js'
import {nativePrompts,nativeGuidance,nativeNudgeSections} from '../docker/plugins/dsh-context-manager/acp-prompts.mjs'
import * as pending from '../docker/plugins/dsh-context-manager/acp-pending.mjs'
import { transaction } from './lib/context-manager-legacy-probe.mjs'
import {normalizeProviderUsage,readSessionCacheLedger} from '../docker/plugins/dsh-context-manager/cache-ledger.mjs'
import {rolloutReadiness} from '../docker/plugins/dsh-context-manager/rollout-readiness.mjs'
import {defaults} from '../docker/plugins/dsh-context-manager/policy.mjs'

test('native kernel distribution is pinned to the verified source and lockfile', async () => {
  const root = new URL('../docker/plugins/dsh-context-manager/', import.meta.url)
  const provenance = JSON.parse(await readFile(new URL('vendor/provenance.json', root), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  const data = await readFile(new URL('vendor/' + provenance.artifact, root))
  assert.equal(createHash('sha256').update(data).digest('hex'), provenance.sha256)
  assert.equal(lock.packages['node_modules/acp-kernel'].integrity, provenance.integrity)
  assert.equal(provenance.upstream.commit, 'bc4a3f87e2dc98e82df6f707d362e75492fdf3d1')
  assert.equal(provenance.reproducibleCleanBuild, true)
})

test('native policy exposes and enforces the configured recent context and growth threshold', () => {
  const session=populated('native-configured-protection')
  const saved=defaults()
  saved.tiered.preserveRecentMessages=4
  saved.tiered.preserveRecentTokens=0
  saved.tiered.nudgeGrowthTokens=12345
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,policyFor:()=>saved})
  const status=runtime.status(session)
  assert.deepEqual(status.protection,{recentMessages:4,recentTokens:0})
  const config=runtime.view(session).config
  assert.equal(config.nudge.growthFloor,12345)
  assert.equal(config.nudge.growthCap,12345)
  const args={startRef:status.refs[0].ref,endRef:status.refs[3].ref,
    summary:'Preserve all original evidence and the four most recent messages according to the configured native policy. '.repeat(3)}
  assert.throws(()=>runtime.propose(session,args),/protected|kernel rejected/)
  assert.equal(runtime.propose(session,{...args,endRef:status.refs[2].ref}).accepted,true)
})

function populated(id, content) {
  const session = Session.create(SessionId(id))
  for(let i=0;i<7;i++) session.append('user/message', {
    id: id+'-'+i, role:'user', source:{kind:'user'},
    content: i===1&&content?content:[{type:'text',text:'Original native safety evidence. '.repeat(90)}],
  }, {surfaceOp:'append'})
  return session
}

test('native range refuses media before writing an intent or mutating the surface', () => {
  const session=populated('m1-media',[{type:'image',url:'https://example.invalid/synthetic.png'}])
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const before=JSON.stringify(session.snapshotEvents())
  assert.throws(()=>runtime.propose(session,{startRef:refs[0].ref,endRef:refs[3].ref,
    summary:'Preserve the full original native evidence and the image without silently hiding non-text data. '.repeat(2)}), /protected|kernel rejected/)
  assert.equal(JSON.stringify(session.snapshotEvents()),before)
})

test('upstream parser accepts legacy boundary spellings without mutating request arguments', () => {
  const session=populated('m1-parser')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const args={startId:refs[0].ref,endId:refs[2].ref,
    summary:'Original native evidence is preserved by the upstream parser and an explicitly bounded DSH transaction. '.repeat(2)}
  const before=JSON.stringify(args)
  assert.equal(runtime.propose(session,args).accepted,true)
  assert.equal(JSON.stringify(args),before)
})

const originalResult=()=>({isError:false,content:[{type:'text',text:JSON.stringify({rows:Array.from({length:800},(_,i)=>({i,value:'exact synthetic original'}))})}]})
const ccrExec=session=>({agent:{session},name:'read_file',callId:'one-call',arguments:{path:'/synthetic'}})
const durable={appendRecord:appendPluginRecord,flush:async()=>true}

test('CCR matches upstream placeholder fields, preserves exact JSON and isolates colliding event sequences', async () => {
  const session=Session.create(SessionId('m2-first')),other=Session.create(SessionId('m2-other'))
  const original=originalResult(),before=structuredClone(original)
  const saved=await offloadCcr(ccrExec(session),original,durable)
  assert.ok(saved)
  const event=session.snapshotEvents().find(e=>e.type===CCR_EVENT)
  assert.equal(event.data.version,2)
  assert.equal(saved.content[0].text,buildStoredPlaceholder({ref:saved.ref,...event.data.entry,retrieveToolName:'acp_ccr_retrieve'}))
  const pieces=[]
  for(let offset=0;;){const page=retrieveCcr(session,{ref:saved.ref,offset,limit:8192});pieces.push(page.content);if(page.nextOffset===null)break;offset=page.nextOffset}
  assert.equal(pieces.join(''),original.content[0].text)
  const another=await offloadCcr(ccrExec(other),original,durable)
  assert.notEqual(saved.ref,another.ref)
  assert.throws(()=>retrieveCcr(other,{ref:saved.ref}),/unavailable/)
  assert.deepEqual(original,before)
  const cold=Session.create(session.id,session.snapshotEvents(),session.header)
  assert.equal(retrieveCcr(cold,{ref:saved.ref}).content,original.content[0].text.slice(0,4096))
})

test('CCR waits for durability and retries without allocating a second reference', async () => {
  const session=Session.create(SessionId('m2-barrier')),result=originalResult()
  let release
  const barrier=new Promise(resolve=>{release=resolve})
  let settled=false
  const pending=offloadCcr(ccrExec(session),result,{appendRecord:appendPluginRecord,flush:()=>barrier}).then(value=>{settled=true;return value})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(settled,false)
  release(false)
  assert.equal(await pending,null)
  const saved=await offloadCcr(ccrExec(session),result,durable)
  const retry=await offloadCcr(ccrExec(session),result,durable)
  assert.equal(saved.ref,retry.ref)
  assert.deepEqual(saved.content,retry.content)
  assert.equal(session.snapshotEvents().filter(e=>e.type===CCR_EVENT).length,1)
  const changed=structuredClone(result);changed.content[0].text+='changed'
  assert.equal(await offloadCcr(ccrExec(session),changed,durable),null)
})

test('CCR preserves unsupported, nested, cancelled and unspoolable results without partial shortening', async () => {
  for(const mode of ['media','nested','cancelled','failed','disk','quota','oversized']) {
    const session=Session.create(SessionId('m2-'+mode)),exec=ccrExec(session),result=originalResult()
    const options={...durable}
    if(mode==='media')result.content.push({type:'image',url:'https://example.invalid/image.png'})
    if(mode==='nested')exec.parent={callId:'parent'}
    if(mode==='cancelled')exec.signal=AbortSignal.abort()
    if(mode==='failed')result.isError=true
    if(mode==='disk')options.flush=async()=>{throw Error('synthetic disk full')}
    if(mode==='quota')options.maxSessionBytes=1
    if(mode==='oversized')result.content[0].text='x'.repeat(900000)
    const before=structuredClone(result)
    assert.equal(await offloadCcr(exec,result,options),null,mode)
    assert.deepEqual(result,before)
  }
})

test('optional upstream truncate/crush projections keep the durable original readable', async () => {
  for(const projection of ['truncate','crush']) {
    const session=Session.create(SessionId('m2-projection-'+projection))
    session.append('request/context',{provider:'synthetic',model:'offline',contextWindow:8192})
    const result=originalResult()
    const saved=await offloadCcr(ccrExec(session),result,{...durable,projection})
    assert.ok(saved)
    assert.ok(saved.content[0].text.length<result.content[0].text.length)
    if(projection==='truncate')assert.match(saved.content[0].text,/truncated for context space/)
    assert.equal(retrieveCcr(session,{ref:saved.ref,limit:8192}).content,result.content[0].text.slice(0,8192))
  }
})

test('absorb queues the complete native pair and rejects duplicated call identities', () => {
  for(const duplicate of [false,true]) {
    const session=Session.create(SessionId('m2-absorb-'+duplicate))
    const call=()=>session.append('assistant/message',{turn:1,step:1,stream:[],message:{
      id:'call-'+session.seq,role:'assistant',source:{kind:'model',provider:'offline',model:'offline'},
      content:[{type:'tool-call',id:'pair1',name:'read_file',arguments:'{}'}],
    }},{surfaceOp:'append'})
    call();if(duplicate)call()
    session.append('tool/result',{turn:1,step:1,message:{id:'result',role:'tool',toolCallId:'pair1',
      content:[{type:'text',text:'Native tool facts and exact source constraints. '.repeat(300)}],source:{kind:'tool'}}},{surfaceOp:'append'})
    for(let i=0;i<4;i++)session.append('user/message',{id:'tail-'+i,role:'user',source:{kind:'user'},
      content:[{type:'text',text:'Keep the current request visible.'}]},{surfaceOp:'append'})
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
    const {refs}=runtime.status(session)
    const args={ref:refs[duplicate?2:1].ref,summary:'The tool confirmed the exact source constraints and native event provenance. Keep all original facts recoverable from the same Session. '.repeat(2)}
    if(duplicate)assert.throws(()=>runtime.proposeAbsorb(session,args),/unambiguous/)
    else assert.equal(runtime.proposeAbsorb(session,args).accepted,true)
    assert.equal(session.snapshotEvents().filter(e=>e.type.includes('acp-state')).length,0)
  }
})

test('batch compression prevalidates disjoint ranges and commits separate recoverable native transactions', async () => {
  const session=populated('m3-batch')
  for(let i=0;i<5;i++)session.append('user/message',{id:'extra-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Further original source facts. '.repeat(80)}]},{surfaceOp:'append'})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  const {refs}=runtime.status(session)
  const summary='Preserve the original source facts, the native transaction boundary, every constraint and all remaining objectives. '.repeat(2)
  assert.throws(()=>runtime.proposeBatch(session,{content:[
    {startId:refs[0].ref,endId:refs[3].ref,summary},
    {startId:refs[2].ref,endId:refs[5].ref,summary},
  ]}),/overlap/)
  assert.equal(runtime.status(session).pending,false)
  assert.equal(runtime.proposeBatch(session,{content:[
    {startId:refs[0].ref,endId:refs[2].ref,summary},
    {startId:refs[3].ref,endId:refs[5].ref,summary},
  ]}).batchQueued,2)
  assert.equal((await runtime.processPending({session},transaction(session,pending))).batchCommitted,2)
  const cold=new AcpRuntime({appendRecord:appendPluginRecord})
  assert.equal(cold.status(Session.create(session.id,session.snapshotEvents(),session.header)).blocks.length,2)
})

test('upstream nudge is byte-identical and repeated status reads do not consume its cadence', () => {
  const session=populated('m3-nudge')
  session.append('request/context',{provider:'offline',model:'tiny',contextWindow:8192})
  for(let i=0;i<3;i++)session.append('user/message',{id:'large-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Large consumed native evidence. '.repeat(2500)}]},{surfaceOp:'append'})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  runtime.status(session)
  const view=runtime.view(session)
  assert.equal(view.nudge.shouldInject,true)
  const text=runtime.nudgeMessage(session)
  assert.equal(text,renderNudgeText(view.nudge,nativePrompts,nativeNudgeSections).text)
  runtime.status(session)
  assert.equal(runtime.nudgeMessage(session),text)
  assert.ok(nativeGuidance.includes(nativePrompts.howToCompressRules))
  assert.doesNotMatch(nativeGuidance,/injected by the proxy/)
})

test('short English and Chinese searches preserve upstream scores and cannot query another Session', async () => {
  const session=populated('m3-search')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  const {refs}=runtime.status(session)
  runtime.propose(session,{startRef:refs[0].ref,endRef:refs[2].ref,
    summary:'nebulazeta, connection pool, \u8fde\u63a5\u6c60: retain exact request boundaries and recover original evidence from the native Session log. '.repeat(2)})
  await runtime.processPending({session},transaction(session,pending))
  const {row}=runtime.view(session)
  for(const algorithm of ['hybrid','bm25','fuzzy','substring'])for(const query of ['nebulazeta','\u8fde\u63a5\u6c60']) {
    const expected=searchBlocks(blockDocs({...row.state,blocks:row.state.blocks.filter(b=>b.active)}),query,{algorithm,limit:10})
    const actual=runtime.search(session,query,{algorithm})
    assert.deepEqual(actual.map(hit=>({id:hit.id,score:hit.score})),expected.map(hit=>({id:hit.blockId,score:hit.score})))
  }
  assert.equal(runtime.search(session,'nebulazeta').length,1)
  assert.deepEqual(runtime.search(populated('m3-search-unrelated'),'nebulazeta'),[])
})

test('provider usage schemas preserve inclusive versus additive cache counts and unknown fields',()=>{
  const fixtures=[
    ['openai-chat',{prompt_tokens:1000,completion_tokens:30,prompt_tokens_details:{cached_tokens:700}}],
    ['openai-responses',{input_tokens:1000,output_tokens:30,input_tokens_details:{cached_tokens:700}}],
    ['anthropic',{input_tokens:200,cache_read_input_tokens:700,cache_creation_input_tokens:100,output_tokens:30}],
    ['dsh',{inputTokens:200,cacheReadTokens:700,cacheWriteTokens:100,outputTokens:30,totalTokens:1030}],
  ]
  for(const [schema,usage] of fixtures){
    const actual=normalizeProviderUsage(usage,{schema})
    assert.equal(actual.known,true,schema)
    assert.deepEqual([actual.input,actual.cached,actual.output],[1000,700,30],schema)
  }
  for(const usage of [{inputTokens:100,outputTokens:20,totalTokens:120},
    {inputTokens:100,outputTokens:20,cacheReadTokens:0},
    {inputTokens:100,outputTokens:20,totalTokens:120,cacheReadTokens:200},
    {inputTokens:100,outputTokens:20,totalTokens:120,cacheReadTokens:10,cacheWriteTokens:0},
    {inputTokens:-1,outputTokens:20,cacheReadTokens:0}]){
    assert.equal(normalizeProviderUsage(usage).known,false)
  }
  assert.equal(normalizeProviderUsage({prompt_tokens:100,completion_tokens:20},{schema:'openai-chat'}).cached,null)
  assert.throws(()=>normalizeProviderUsage({}, {schema:'guess'}),/unknown/)
})

function usageSample(session,{model='one',known=true,input=1000,cached=700}={}) {
  return session.append('assistant/message',{turn:1,step:1,stream:[],
    usage:{inputTokens:input-cached,outputTokens:30,totalTokens:input+30,
      ...(known?{cacheReadTokens:cached,cacheWriteTokens:0}:{})},
    message:{id:'usage-'+session.seq,role:'assistant',source:{kind:'model',provider:'offline',model},
      content:[{type:'text',text:'SECRET_PROVIDER_MESSAGE'}]},
  },{surfaceOp:'append'})
}

test('cache reports balance exactly and separate unknown, route, series and inherited boundaries',()=>{
  const session=populated('m4-cache')
  session.append('request/context',{provider:'offline',model:'one',contextWindow:8192})
  usageSample(session);usageSample(session,{input:1100,cached:800})
  usageSample(session,{known:false});usageSample(session);usageSample(session,{model:'two'})
  session.append('assistant/attempt',{turn:1,step:1,stream:[]})
  usageSample(session,{model:'two'})
  session.append('request/header',{header:{config:{provider:'offline',model:'two'}},reason:'series',startsSeries:true})
  usageSample(session,{model:'two'})
  const before=JSON.stringify(session.snapshotEvents())
  const result=readSessionCacheLedger(session,{detail:'full'})
  assert.equal(result.requestsObserved,7)
  assert.equal(result.requestsWithCompleteUsage,6)
  assert.equal(result.unknownRequests,1)
  assert.equal(result.attemptsWithoutUsage,1)
  assert.deepEqual(result.groups.map(g=>g.kind==='measured'?g.report.totals.requests:'unknown'),[2,'unknown',1,1,1,1])
  for(const group of result.groups.filter(g=>g.kind==='measured')){
    const t=group.report.totals
    assert.equal(t.input,t.cached+t.newContent+t.compRepay+t.ttlRepay)
    assert.equal(t.balanced,true)
  }
  assert.equal(JSON.stringify(session.snapshotEvents()),before)
  assert.doesNotMatch(JSON.stringify(result),/SECRET_PROVIDER_MESSAGE|Original native safety/)
  assert.equal(result.currency,null)
  assert.equal(result.providerExperimentAccepted,false)
  const fork=Session.create(SessionId('m4-fork'),session.snapshotEvents(),{...session.header,id:SessionId('m4-fork'),isSeeded:true},session.snapshotEvents().length)
  usageSample(fork,{model:'two'})
  assert.equal(readSessionCacheLedger(fork).groups.at(-1).origin,'live')
  assert.equal(readSessionCacheLedger(fork).groups.at(-2).origin,'inherited')
})

test('native fold economics require a closed transaction and retain boundary attribution gaps',async()=>{
  for(const boundary of [false,true]){
    const session=populated('m4-fold-'+boundary)
    session.append('request/context',{provider:'offline',model:'one',contextWindow:8192})
    usageSample(session)
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
    const {refs}=runtime.status(session)
    runtime.propose(session,{startRef:refs[0].ref,endRef:refs[2].ref,
      summary:'Preserve original native facts and constraints; this synthetic summary is used only to check cache attribution boundaries. '.repeat(2)})
    await runtime.processPending({session},transaction(session,pending))
    if(boundary)session.append('request/context',{provider:'offline',model:'two',contextWindow:8192})
    usageSample(session,{model:boundary?'two':'one',input:600,cached:0})
    const result=readSessionCacheLedger(session,{detail:'full'})
    assert.equal(result.folds.length,1)
    assert.equal(result.folds[0].tokensCompressed,800)
    assert.equal(result.unattributedFolds.length,boundary?1:0)
    assert.equal(result.groups.reduce((n,g)=>n+(g.report?.folds.length??0),0),boundary?0:1)
    const broken=session.snapshotEvents().filter(e=>e.type!=='compaction/end')
    const partial=readSessionCacheLedger({id:session.id,snapshotEvents:()=>broken})
    assert.equal(partial.folds.length,0)
    assert.equal(partial.incompleteCompactions,1)
  }
})

const foldArgs=runtime=>session=>{
  const {refs}=runtime.status(session)
  return {startRef:refs[0].ref,endRef:refs[2].ref,
    summary:'Keep native source evidence, exact constraints and the full user objective recoverable from the authoritative Session log. '.repeat(2)}
}

test('Session processing lease spans flush and batch commit while another Session remains independent',async()=>{
  const session=populated('m5-leases'),other=populated('m5-independent')
  let release
  const barrier=new Promise(resolve=>{release=resolve})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:()=>barrier})
  const competitor=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  const args=foldArgs(runtime)(session)
  runtime.propose(session,args)
  const running=runtime.processPending({session},transaction(session,pending))
  assert.equal(await runtime.processPending({session},transaction(session,pending)),null)
  assert.throws(()=>competitor.propose(session,args),/processing|queued/)
  competitor.propose(other,foldArgs(competitor)(other))
  assert.ok(await competitor.processPending({session:other},transaction(other,pending)))
  release(true)
  await running
  assert.equal(session.snapshotEvents().filter(e=>e.type==='compaction/start').length,1)
  assert.equal(competitor.status(session).blocks.length,1)
  assert.equal(pending.hasQueuedAcpSummary(session),false)
})

test('flush races with native overflow, state changes or cancellation cannot dispatch stale ACP work',async()=>{
  for(const mode of ['surface','state','abort']){
    const session=populated('m5-race-'+mode),abort=new AbortController()
    let release,calls=0
    const barrier=new Promise(resolve=>{release=resolve})
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:()=>barrier})
    runtime.propose(session,foldArgs(runtime)(session))
    const running=runtime.processPending({session},{compactRegion(){calls++;throw Error('stale dispatch')}},abort.signal)
    if(mode==='surface'){
      const start=session.surface.nodes[0]
      session.append('user/message',{id:'native-overflow',role:'user',source:{kind:'user'},
        content:[{type:'text',text:'Native overflow replaced the original prefix.'}]},
      {surfaceOp:{op:'replace',startSeq:start,endSeq:start},sourceEventSeqs:[start]})
    }else if(mode==='state'){
      const {row}=runtime.view(session)
      appendPluginRecord(session,STATE_EVENT,JSON.parse(JSON.stringify({version:1,state:row.state,checkpoints:{}})))
    }else abort.abort(Error('synthetic cancellation after intent flush'))
    release(true)
    await assert.rejects(running,/changed|cancellation/)
    assert.equal(calls,0,mode)
    assert.equal(runtime.status(session).pending,false)
    assert.equal(pending.hasQueuedAcpSummary(session),false)
    assert.equal(pending.currentAcpSummary(session),null)
  }
})

test('partial durable native transactions refuse recovery; missing ACK and duplicate intent recover once',async()=>{
  const session=populated('m5-faults')
  const runtime=new AcpRuntime({appendRecord:(s,type,data)=>{
    if(type===STATE_EVENT)throw Error('synthetic crash before ACK')
    const event=appendPluginRecord(s,type,data)
    if(type===INTENT_EVENT)appendPluginRecord(s,type,data)
    return event
  },flushIntent:async()=>true})
  runtime.propose(session,foldArgs(runtime)(session))
  await assert.rejects(runtime.processPending({session},transaction(session,pending)),/before ACK/)
  const events=session.snapshotEvents()
  const cold=suffix=>Session.create(session.id,suffix,session.header)
  const restored=new AcpRuntime({appendRecord:appendPluginRecord})
  assert.equal(restored.status(cold(events)).blocks.length,1)
  assert.equal(restored.status(cold(events)).recoveredFromNativeLog,true)
  const begin=events.findIndex(e=>e.type==='compaction/start')
  const end=events.findIndex(e=>e.type==='compaction/end')
  for(let cut=begin+1;cut<=end;cut++){
    assert.throws(()=>new AcpRuntime({appendRecord:appendPluginRecord}).status(cold(events.slice(0,cut))),/unfinished/)
  }
  assert.equal(new AcpRuntime({appendRecord:appendPluginRecord}).status(cold(events.slice(0,begin))).blocks.length,0)
  assert.equal(session.snapshotEvents().filter(e=>e.type===STATE_EVENT).length,0)
  assert.equal(events.filter(e=>e.type==='compaction/start').length,1)
})

test('runtime rollout readout cannot promote configuration, derivative presets or unmeasured traffic',()=>{
  const metric=active=>({active,configured:active,conditional:0})
  const row={id:'standard',mounted:true,basic:metric(0),tiered:metric(1),acp:metric(1),manual:metric(1),external:metric(0)}
  const inventory={available:true,presets:[row,{...row,id:'reverse-engineering'},{...row,id:'research'}]}
  const result=rolloutReadiness({active:true,acp:true},{preset:'standard'},inventory)
  assert.equal(result.observedStage,'isolated-standard-lab')
  assert.equal(result.productionApproved,false)
  assert.equal(result.sharedHistoryApproved,false)
  assert.deepEqual(result.presets.map(p=>p.isolatedAcpEligible),[true,false,false])
  assert.ok(result.presets.every(p=>p.acceptance==='blocked'&&p.providerUsage==='not-observed'))
  assert.equal(rolloutReadiness({active:true,acp:true},null,inventory).observedStage,'not-proven')
  for(const changed of [{truncated:true},{presets:[{...row,broken:true}]},
    {presets:[{...row,basic:metric(1)}]},{presets:[{...row,tiered:{...metric(1),conditional:1}}]}]){
    assert.equal(rolloutReadiness({active:true,acp:true},{preset:'standard'},{...inventory,...changed}).observedStage,'not-proven')
  }
})

test('native adapter refuses duplicated or incomplete tool identities before persisting an intent',()=>{
  for(const mode of ['duplicate','incomplete','paired']){
    const session=Session.create(SessionId('m5-tool-'+mode))
    const call=()=>session.append('assistant/message',{turn:1,step:1,stream:[],message:{
      id:'call-'+session.seq,role:'assistant',source:{kind:'model',provider:'offline',model:'one'},
      content:[{type:'tool-call',id:'same-id',name:'read_file',arguments:JSON.stringify({text:'Original tool arguments '.repeat(200)})}],
    }},{surfaceOp:'append'})
    call();if(mode==='duplicate')call()
    if(mode!=='incomplete')session.append('tool/result',{turn:1,step:1,message:{
      id:'result',role:'tool',toolCallId:'same-id',source:{kind:'tool'},
      content:[{type:'text',text:'Original tool result '.repeat(200)}],
    }},{surfaceOp:'append'})
    for(let i=0;i<4;i++)session.append('user/message',{id:'tail-'+i,role:'user',source:{kind:'user'},
      content:[{type:'text',text:'Current safe tail '.repeat(100)}]},{surfaceOp:'append'})
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
    const {refs}=runtime.status(session)
    const args={...foldArgs(runtime)(session),endRef:refs[mode==='duplicate'?2:1].ref}
    if(mode==='paired')assert.equal(runtime.propose(session,args).accepted,true)
    else assert.throws(()=>runtime.propose(session,args),/complete unambiguous/)
    assert.equal(session.snapshotEvents().filter(e=>e.type===INTENT_EVENT).length,0)
  }
})

test('cache fold prefix includes native system text and invalid explicit counters are unknown',async()=>{
  assert.equal(normalizeProviderUsage({inputTokens:-1,cacheReadTokens:0,outputTokens:20,totalTokens:120}).known,false)
  const session=Session.create(SessionId('m5-system-prefix'))
  const system='Native system prefix instructions '.repeat(100)
  session.append('system/message',{turn:1,step:1,message:{role:'system',content:[{type:'text',text:system}]}},{surfaceOp:'append'})
  for(let i=0;i<7;i++)session.append('user/message',{id:'m'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Original prefix evidence '.repeat(100)}]},{surfaceOp:'append'})
  session.append('request/context',{provider:'offline',model:'one',contextWindow:8192})
  usageSample(session)
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  runtime.propose(session,foldArgs(runtime)(session))
  await runtime.processPending({session},transaction(session,pending))
  usageSample(session)
  const report=readSessionCacheLedger(session,{detail:'full'})
  assert.ok(report.folds[0].firstFoldStartTokens>100)
  assert.equal(report.unattributedFolds.length,0)
})

test('selected plain text from an unclosed native step is rejected before any intent',()=>{
  const session=populated('m5-open-step')
  session.append('turn/start',{turn:1})
  session.append('step/start',{turn:1,step:1})
  session.append('assistant/message',{turn:1,step:1,stream:[],message:{id:'open-output',role:'assistant',
    source:{kind:'model',provider:'offline',model:'one'},content:[{type:'text',text:'Unsettled native output '.repeat(200)}]}},{surfaceOp:'append'})
  for(let i=0;i<3;i++)session.append('user/message',{id:'open-tail-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Preserve the current open step.'}]},{surfaceOp:'append'})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const args={...foldArgs(runtime)(session),endRef:refs[7].ref}
  assert.throws(()=>runtime.propose(session,args),/unclosed native step/)
  assert.equal(session.snapshotEvents().filter(e=>e.type===INTENT_EVENT).length,0)
  session.append('step/end',{turn:1,step:1})
  assert.equal(runtime.propose(session,args).accepted,true)
})
