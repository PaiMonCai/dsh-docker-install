/**
 * Full ACTUAL DSH ReactLoopAgent / ToolRuntime / Session integration with a
 * deterministic offline LlmAdapter. No real provider traffic or proxy.
 *
 * Model sequence:
 *   acp_status -> acp_compress -> (native preStep compaction)
 *   -> acp_search_context -> acp_decompress -> assistant text.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {configureNativePlugin} from '/opt/dsh/plugins/dsh-context-manager/native-plugin.mjs'
import {defaults} from '/opt/dsh/plugins/dsh-context-manager/policy.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const load=p=>import(pathToFileURL(rq.resolve(p)).href)
const [cordis,llm,sessions,projections,system,tools,agents,loop,meter,tiered,acp]=await Promise.all([
 load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-llm'),
 load('@deepseek-ai/dsh-session'),load('@deepseek-ai/dsh-session-projection'),
 load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-tools'),
 load('@deepseek-ai/dsh-agent'),load('@deepseek-ai/dsh-agent-loop'),
 load('@deepseek-ai/dsh-token-meter'),
 import('/opt/dsh/plugins/dsh-context-manager/tiered-native.js'),
 import('/opt/dsh/plugins/dsh-context-manager/acp-native.js'),
])
const oldGate=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
const builtin=process.argv.includes('--builtin')
const canonical=process.argv.includes('--canonical')
if (builtin) {
 const saved=defaults();saved.engine='tiered';saved.nativePlugin.enabled=true
 saved.tiered.preserveRecentMessages=2;saved.tiered.preserveRecentTokens=0
 delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
 configureNativePlugin(saved,{})
} else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
const ctx=new cordis.Context()
const owned=[]
async function mount(plugin,config){
 const fiber=ctx.plugin(plugin,config)
 await fiber
 owned.push(fiber)
 return fiber
}
let agent=null
const visited=[]
let calls=0
const summary='Verified original requirements, model selection and DSH event provenance must survive the native ACP transaction. The context manager stays a Cordis plugin, never redirects model traffic, and all original events remain restorable. '.repeat(2)
class OfflineAdapter extends llm.LlmAdapter {
 async resolveModel(provider,model){
  return {provider,id:model,name:model,contextWindow:1000000}
 }
 async *stream(request){
  if(builtin&&request.purpose==='compaction'&&calls>=6) {
   yield {type:'block-start',index:0,blockType:'text'}
   yield {type:'block-end',index:0,block:{type:'text',text:'Ordinary native summary after enhancement was disabled.'}}
   yield {type:'finish',reason:{kind:'stop'}}
   return
  }
  const n=calls++
  const events=agent.session.snapshotEvents().filter(e=>e.type==='tool/result')
  const last=events.at(-1)
  let body=''
  if(last){
   body=last.data?.message?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n')??''
  }
  const parsed=()=>{
   assert.ok(body,'missing prior native tool response in model Agent Loop')
   return JSON.parse(body)
  }
  let name='',args={}
  if(n===0){name='acp_status'}
  else if(n===1){
   const status=parsed()
   assert.ok(status.refs?.length>=5)
   name=canonical?'compress':'acp_compress'
   args=canonical?{startId:status.refs[0].ref,endId:status.refs[3].ref,content:summary}:
    {startRef:status.refs[0].ref,endRef:status.refs[3].ref,summary,topic:'verified original evidence'}
  }else if(n===2){
   const accepted=parsed()
   assert.equal(accepted.accepted,true)
   const events=agent.session.snapshotEvents()
   assert.equal(events.filter(e=>e.type==='compaction/end'&&e.data.error===undefined).length,1)
   name='acp_search_context'
   args={query:'Verified original requirements'}
  }else if(n===3){
   const found=parsed()
   assert.ok(found.length>0)
   name='acp_decompress'
   args={blockId:found[0].id}
  }else if(n===4){
   const original=parsed()
   assert.ok(original.original.includes('Verified original facts'))
   name='acp_cache'
   args={detail:'full'}
  }else if(n===5){
   const ledger=parsed()
   assert.equal(ledger.scope,'current-native-session')
   assert.equal(ledger.requestsWithCompleteUsage,5)
   assert.equal(ledger.unknownRequests,0)
   assert.equal(ledger.currency,null)
   assert.ok(ledger.groups.every(g=>g.report.totals.balanced))
   visited.push('final')
   yield {type:'block-start',index:0,blockType:'text'}
   yield {type:'block-end',index:0,block:{type:'text',text:'ACP native loop completed successfully'}}
   yield {type:'usage',usage:{inputTokens:300,cacheReadTokens:700,cacheWriteTokens:0,outputTokens:30,totalTokens:1030}}
   yield {type:'finish',reason:{kind:'stop'}}
   return
  }else throw Error('unexpected additional mock model request '+n)
  visited.push(name)
  const callId=llm.ToolCallId('acp-loop-call-'+n)
  yield {type:'block-start',index:0,blockType:'tool-call'}
  yield {type:'block-end',index:0,block:{type:'tool-call',
   id:callId,name,arguments:JSON.stringify(args)}}
  yield {type:'usage',usage:{inputTokens:300,cacheReadTokens:700,cacheWriteTokens:0,outputTokens:30,totalTokens:1030}}
  yield {type:'finish',reason:{kind:'tool-calls'}}
 }
}
try{
 for(const plugin of [llm.default,sessions.default,projections.default])
  await mount(plugin)
 await mount(system.default,{})
 await mount(tools.default,{})
 await mount(agents.default)
 await mount(meter.default)
 const tieredFiber=await mount(tiered.default,{auto:true,thresholdRatio:.8})
 const acpFiber=await mount(acp,builtin?{mode:'builtin'}:undefined)
 await mount(loop.default,{agents:[]})
 ctx.on('session/flush',()=>{})
 ctx.llm.registerAdapter(['offline'],new OfflineAdapter())
 agent=await ctx.agentLoop.create(sessions.SessionId('acp-offline-real-loop'),{
  provider:'offline',model:'offline',maxTokens:1024,
 })
 // An existing long conversation, authored in the same native Session,
 // gives the model a safe historical prefix to compress.
 for(let i=0;i<7;i++)agent.session.append('user/message',{
  id:'acp-history-'+i,role:'user',source:{kind:'user'},
  content:[{type:'text',text:'Verified original facts '+i+' '.repeat(20)
   +'must remain recoverable. '.repeat(40)}],
 },{surfaceOp:'append'})
 const idle=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('offline ACP Agent Loop did not become idle')),20000)
  const dispose=ctx.on('agent/status',({agent:subject,status})=>{
   if(subject===agent&&status==='idle') {
    dispose();clearTimeout(timeout);resolve()
   }
  })
 })
 agent.followup(llm.createUserMessage({content:[{type:'text',text:'Summarize earlier history safely'}],
  source:{kind:'user'}}))
 await idle
 assert.deepEqual(visited,['acp_status',canonical?'compress':'acp_compress','acp_search_context','acp_decompress','acp_cache','final'])
 assert.equal(calls,6)
 const events=agent.session.snapshotEvents()
 assert.equal(events.filter(e=>e.type==='compaction/end'&&e.data.error===undefined).length,1)
 assert.equal(events.filter(e=>e.type==='tool/result').length,5)
 assert.equal(events.filter(e=>e.type==='compaction/start').length,1)
 assert.equal(events.filter(e=>e.type==='compaction/summary').length,1)
 process.stdout.write('DSH_CONTEXT_MANAGER_ACP_AGENT_LOOP_PASS tools=5 turns=1 nativeCompaction=1 replayable=true cacheLedger=true\n')
 if(builtin) {
  const original='Exact native ToolRuntime CCR evidence. '.repeat(1800)
  ctx.tools.register(tools.defineTool({name:'native_large_result',description:'Offline CCR fixture',parameters:{},
   output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:()=>original}))
  const large=await ctx.tools.execute({callId:'native-ccr-real-pipeline',name:'native_large_result',arguments:{},
   agent,signal:new AbortController().signal})
  assert.equal(large.isError,false)
  const ref=/dshccr:v2:[a-f0-9]{16}:[0-9]+/.exec(large.content.map(row=>row.text??'').join('\n'))?.[0]
  assert.ok(ref,'native CCR hook must shorten the actual ToolRuntime result only after durable storage')
  await acpFiber.dispose()
  await tieredFiber.dispose()
  configureNativePlugin(defaults(),{})
  const basic=await load('@deepseek-ai/dsh-compaction-basic')
  await mount(basic.default,{auto:true})
  const checkpoint=agent.session.surface.nodes.find(seq=>agent.session.eventAt(seq)?.data?.source?.kind==='compact-checkpoint')
  assert.ok(Number.isSafeInteger(checkpoint))
  const recoveryTurn=agent.session.snapshotEvents().filter(event=>event.type==='turn/start').at(-1).data.turn+1
  agent.session.append('turn/start',{turn:recoveryTurn})
  await ctx.compaction.compactRegion(checkpoint,checkpoint,agent,new AbortController().signal)
  agent.session.append('turn/end',{turn:recoveryTurn,reason:{kind:'completed'}})
  const {installNativeReaders}=await import('/opt/dsh/plugins/dsh-context-manager/native-readers.js')
  installNativeReaders(agent)
  const fresh=await ctx.agentLoop.create(sessions.SessionId('native-reader-isolated-fresh'),{
   provider:'offline',model:'offline',maxTokens:1024,
  })
  assert.ok(ctx.tools.schemas(agent).some(row=>row.name==='retrieve'))
  assert.ok(!ctx.tools.schemas(agent).some(row=>row.name==='compress'))
  assert.ok(!ctx.tools.schemas(fresh).some(row=>row.name==='retrieve'))
  const before=JSON.stringify(agent.session.snapshotEvents())
  let restored='',offset=0
  for(;;) {
   const result=await ctx.tools.execute({callId:'reader-page-'+offset,name:'retrieve',arguments:{ref,offset,limit:8192},
    agent,signal:new AbortController().signal})
   assert.equal(result.isError,false,JSON.stringify(result))
   const page=JSON.parse(result.value);restored+=page.content
   if(page.nextOffset===null)break
   offset=page.nextOffset
  }
  assert.equal(restored,original)
  const list=await ctx.tools.execute({callId:'historical-block-list',name:'retrieve',arguments:{blockId:'b1'},
   agent,signal:new AbortController().signal})
  assert.equal(list.isError,false,JSON.stringify(list))
  const source=JSON.parse(list.value).sources[0]
  const history=await ctx.tools.execute({callId:'historical-block-page',name:'retrieve',arguments:{blockId:'b1',ref:source.ref,limit:8192},
   agent,signal:new AbortController().signal})
  assert.equal(history.isError,false,JSON.stringify(history))
  assert.ok(JSON.parse(history.value).text.includes('Verified original facts'))
  assert.equal(JSON.stringify(agent.session.snapshotEvents()),before)
  const lift=agent.ctx.tools.guard(exec=>exec.name==='retrieve'?'native policy denies retrieval':undefined)
  const denied=await ctx.tools.execute({callId:'reader-denied',name:'retrieve',arguments:{ref},
   agent,signal:new AbortController().signal})
  assert.equal(denied.isError,true)
  lift()
  process.stdout.write('DSH_CONTEXT_MANAGER_NATIVE_PLUGIN_LOOP_PASS labFlags=false ccrToolRuntime=true readerIsolation=true readerPolicyPreserved=true basicRecompaction=true\n')
 }
}finally{
 for(const fiber of owned.reverse())await fiber.dispose()
 if(oldGate===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
 else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=oldGate
}
