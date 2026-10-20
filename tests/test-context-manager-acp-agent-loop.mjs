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
process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
const ctx=new cordis.Context()
const owned=[]
async function mount(plugin,config){
 const fiber=ctx.plugin(plugin,config)
 await fiber
 owned.push(fiber)
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
   name='acp_compress'
   args={startRef:status.refs[0].ref,endRef:status.refs[3].ref,summary,topic:'verified original evidence'}
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
   visited.push('final')
   yield {type:'block-start',index:0,blockType:'text'}
   yield {type:'block-end',index:0,block:{type:'text',text:'ACP native loop completed successfully'}}
   yield {type:'finish',reason:{kind:'stop'}}
   return
  }else throw Error('unexpected additional mock model request '+n)
  visited.push(name)
  const callId=llm.ToolCallId('acp-loop-call-'+n)
  yield {type:'block-start',index:0,blockType:'tool-call'}
  yield {type:'block-end',index:0,block:{type:'tool-call',
   id:callId,name,arguments:JSON.stringify(args)}}
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
 await mount(tiered.default,{auto:true,thresholdRatio:.8})
 await mount(acp)
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
 assert.deepEqual(visited,['acp_status','acp_compress','acp_search_context','acp_decompress','final'])
 assert.equal(calls,5)
 const events=agent.session.snapshotEvents()
 assert.equal(events.filter(e=>e.type==='compaction/end'&&e.data.error===undefined).length,1)
 assert.equal(events.filter(e=>e.type==='tool/result').length,4)
 assert.equal(events.filter(e=>e.type==='compaction/start').length,1)
 assert.equal(events.filter(e=>e.type==='compaction/summary').length,1)
 process.stdout.write('DSH_CONTEXT_MANAGER_ACP_AGENT_LOOP_PASS tools=4 turns=1 nativeCompaction=1 replayable=true\n')
}finally{
 for(const fiber of owned.reverse())await fiber.dispose()
 if(oldGate===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
 else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=oldGate
}
