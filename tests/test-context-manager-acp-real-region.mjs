/**
 * Real upstream DSH compactRegion transaction with an ACP model-authored
 * summary. No fake compaction backend, paid LLM, provider tokens, or proxy.
 */
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime,STATE_EVENT,INTENT_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const load=p=>import(pathToFileURL(rq.resolve(p)).href)
const [cordis,llm,sessions,projection,tokens,tiered]=await Promise.all([
 load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-llm'),
 load('@deepseek-ai/dsh-session'),load('@deepseek-ai/dsh-session-projection'),
 load('@deepseek-ai/dsh-token-meter'),
 import('/opt/dsh/plugins/dsh-context-manager/tiered-native.js'),
])
const {Session,SessionId,appendPluginRecord}=sessions
const large='Original real DSH native compactRegion safety evidence. '.repeat(450)
const home=mkdtempSync(join(tmpdir(),'acp-native-real-region-'))
const oldHome=process.env.DSH_HOME,oldGate=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
process.env.DSH_HOME=home
process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
try {
 const ctx=new cordis.Context()
 new llm.default(ctx)
 new sessions.default(ctx)
 new projection.default(ctx)
 new tokens.default(ctx)
 const engine=new tiered.default(ctx,{auto:false,maxTokens:2048,headroomTokens:4096})
 const session=Session.create(SessionId('acp-native-real-region'))
 for(let turn=1;turn<=4;turn++){
  session.append('turn/start',{turn})
  session.append('user/message',llm.createUserMessage({
   content:[{type:'text',text:large+' turn='+turn}],source:{kind:'user'},
  }),{surfaceOp:'append'})
  session.append('step/start',{turn,step:1})
  if(turn===1)session.append('request/header',{
   header:{config:{provider:'mock',model:'mock'}},reason:'initial',
  })
  session.append('assistant/message',{stream:[],turn,step:1,
   message:llm.createAssistantMessage({
    content:[{type:'text',text:'Confirmed result '+turn}],
    source:{provider:'mock',model:'mock'},
   })},{surfaceOp:'append'})
  session.append('step/end',{turn,step:1})
  session.append('turn/end',{turn,reason:{kind:'completed'}})
 }
 session.append('turn/start',{turn:5})
 const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
 const before=runtime.status(session)
 assert.equal(before.refs.length,8)
 const proposal=runtime.propose(session,{
  startRef:before.refs[0].ref,endRef:before.refs[5].ref,
  topic:'real native transaction',
  summary:'The user requires native ACP compression with verifiable DSH provenance. The first three turns establish a working Context Manager, and the final turn remains visible. Original evidence, constraints, decisions and the next action are preserved. '.repeat(2),
 })
 assert.equal(proposal.accepted,true)
 const agent={id:'offline-native-acp',session,options:{provider:'mock',model:'mock'}}
 const result=await runtime.processPending(agent,engine,new AbortController().signal)
 assert.equal(result.block,proposal.block)
 const events=session.snapshotEvents()
 assert.equal(events.filter(e=>e.type===INTENT_EVENT).length,1)
 assert.equal(events.filter(e=>e.type===STATE_EVENT).length,1)
 assert.equal(events.filter(e=>e.type==='compaction/start').length,1)
 assert.equal(events.filter(e=>e.type==='compaction/summary').length,1)
 assert.equal(events.filter(e=>e.type==='compaction/end'&&e.data.error===undefined).length,1)
 const checkpoint=events.find(e=>e.type==='user/message'&&e.data?.source?.kind==='compact-checkpoint')
 assert.ok(checkpoint)
 const restored=Session.create(session.id,events,session.header)
 assert.deepEqual(restored.surface.nodes,session.surface.nodes)
 const cold=new AcpRuntime({appendRecord:appendPluginRecord})
 assert.ok(cold.status(restored).blocks.some(b=>b.id===proposal.block))
 assert.match(cold.decompress(restored,proposal.block).original,/Original real DSH native/)
 process.stdout.write('DSH_CONTEXT_MANAGER_ACP_REAL_REGION_PASS transaction=true coldReplay=true\n')
}finally {
 if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
 if(oldGate===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
 else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=oldGate
 rmSync(home,{force:true,recursive:true})
}
