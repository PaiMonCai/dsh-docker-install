/**
 * Real DSH native plugin record and real post-execute ToolRuntime integration.
 * No external adapter, filesystem sidecar, fetch interception or network.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {offloadCcr,retrieveCcr,CCR_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-ccr.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const load=p=>import(pathToFileURL(rq.resolve(p)).href)
const [sessions,cordis,system,tools,acp]=await Promise.all([
  load('@deepseek-ai/dsh-session'),load('@deepseek-ai/cordis'),
  load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-tools'),
  import('/opt/dsh/plugins/dsh-context-manager/acp-native.js'),
])
const session=sessions.Session.create(sessions.SessionId('ccr-durable-session'))
const exact='SOURCE-LINE-'.repeat(3600)
const exec={agent:{session},name:'read_file',callId:'ccr-example'}
const result={isError:false,content:[{type:'text',text:exact}]}
const failed=await offloadCcr(exec,result,{appendRecord:sessions.appendPluginRecord,flush:async()=>false})
assert.equal(failed,null)
const saved=await offloadCcr(exec,result,{appendRecord:sessions.appendPluginRecord,flush:async()=>true})
assert.ok(saved?.ref.startsWith('ccr:'))
assert.equal(session.snapshotEvents().filter(e=>e.type===CCR_EVENT).length,2)
const full=[]
let offset=0
while(true){
 const page=retrieveCcr(session,{ref:saved.ref,offset,limit:8192})
 full.push(page.content)
 if(page.nextOffset===null)break
 offset=page.nextOffset
}
assert.equal(full.join(''),exact)
assert.throws(()=>retrieveCcr(session,{ref:'ccr:999999'}),/unavailable/)
assert.throws(()=>retrieveCcr(session,{ref:saved.ref,limit:10000}),/paging/)
const other=sessions.Session.create(sessions.SessionId('another-session'))
assert.throws(()=>retrieveCcr(other,{ref:saved.ref}),/unavailable/)
const nontext=await offloadCcr(exec,{isError:false,content:[{type:'image',data:'...'}]},{
 appendRecord:sessions.appendPluginRecord,flush:async()=>true,
})
assert.equal(nontext,null)
const badTooLarge=await offloadCcr(exec,{isError:false,content:[{type:'text',text:'X'.repeat(900000)}]},{
 appendRecord:sessions.appendPluginRecord,flush:async()=>true,
})
assert.equal(badTooLarge,null)

const prev=process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE
process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE='1'
const ctx=new cordis.Context(),mounted=[]
const mount=async (p,cfg)=>{const fiber=ctx.plugin(p,cfg);await fiber;mounted.push(fiber)}
try{
 await mount(system.default,{})
 await mount(tools.default,{})
 await mount(sessions.default)
 // DSH returns true if there is an attached session/flush listener.
 ctx.on('session/flush',()=>{})
 await mount(acp)
 const tool=tools.defineTool({
   name:'read_native_large',description:'Synthetic tool returning large text',
   parameters:{},
   output:{schema:{type:'string'},render:(_a,value)=>[{type:'text',text:value}]},
   async execute(){return exact},
 })
 ctx.tools.register(tool)
 const agent={id:'ccr-owner-agent',session}
 const invocation=async()=>ctx.tools.execute({
   callId:'ccr-tool-'+String(session.snapshotEvents().length),
   name:'read_native_large',arguments:{},agent,signal:new AbortController().signal,
 })
 const settled=await invocation()
 assert.equal(settled.isError,false)
 assert.equal(settled.value,exact)
 assert.ok(settled.content[0].text.length<600)
 assert.match(settled.content[0].text,/ccr:/)
 const events=session.snapshotEvents().filter(e=>e.type===CCR_EVENT)
 assert.equal(events.length,3)
 const ref=/ccr:\d+/.exec(settled.content[0].text)[0]
 assert.equal(retrieveCcr(session,{ref,offset:0,limit:4096}).content,exact.slice(0,4096))
 process.stdout.write('DSH_CONTEXT_MANAGER_CCR_PASS native=true durable=true lossless=true pipeline=true\n')
}finally{
 for(const fiber of mounted.reverse())await fiber.dispose()
 if(prev===undefined)delete process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE
 else process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE=prev
}
