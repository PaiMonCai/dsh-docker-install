/**
 * Test the REAL installed DSH ToolRuntime pipeline and the ACP plugin,
 * not direct calls to AcpRuntime. Offline controlled Agent handle.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const use=p=>import(pathToFileURL(rq.resolve(p)).href)
const [cordis,system,tools,sessions,acpPlugin]=await Promise.all([
 use('@deepseek-ai/cordis'),use('@deepseek-ai/dsh-system-prompt'),
 use('@deepseek-ai/dsh-tools'),use('@deepseek-ai/dsh-session'),
 import('/opt/dsh/plugins/dsh-context-manager/acp-native.js'),
])
const ctx=new cordis.Context()
new system.default(ctx,{})
new tools.default(ctx)
new sessions.default(ctx)
acpPlugin.apply(ctx)
const names=ctx.tools.schemas().map(t=>t.name)
for(const name of ['acp_status','acp_compress','acp_decompress','acp_search_context'])
 assert.ok(names.includes(name),'missing native tool schema '+name)
const session=sessions.Session.create(sessions.SessionId('acp-real-tool-pipeline'))
const large='Native ACP model tool must preserve verified event-log evidence. '.repeat(25)
for(let i=0;i<9;i++)session.append('user/message',{
 id:'tool-pipe-'+i,role:'user',source:{kind:'user'},
 content:[{type:'text',text:large+' source '+i}],
},{surfaceOp:'append'})
const agent={id:'offline-acp-agent',ctx,session,options:{provider:'mock',model:'mock'}}
let index=0
async function execute(name,args){
 return ctx.tools.execute({callId:'acp-model-call-'+ ++index,name,arguments:args,
  agent,signal:new AbortController().signal})
}
function decoded(result){
 assert.equal(result.isError,false,JSON.stringify(result.error))
 assert.equal(typeof result.value,'string')
 return JSON.parse(result.value)
}
const before=decoded(await execute('acp_status',{}))
assert.equal(before.refs.length,9)
const incorrect=await execute('acp_compress',{
 startRef:'m99999',endRef:'m99998',summary:'An unacceptable reference cannot modify the native Session history. '.repeat(2)})
assert.equal(incorrect.isError,true)
const proposal=decoded(await execute('acp_compress',{
 startRef:before.refs[0].ref,endRef:before.refs[4].ref,
 summary:'Model-authored ACP proposal establishes the original facts and all constraints while retaining DSH source provenance. No proxy process runs. '.repeat(2),
 topic:'native tools',
}))
assert.equal(proposal.accepted,true)
assert.equal(proposal.mode,'next-agent-step')
assert.equal(decoded(await execute('acp_status',{})).pending,true)
const duplicate=await execute('acp_compress',{
 startRef:before.refs[0].ref,endRef:before.refs[4].ref,
 summary:'A second proposal must not overwrite the queued first proposal for the same live Agent and Session. '.repeat(2),
})
assert.equal(duplicate.isError,true)
assert.deepEqual(decoded(await execute('acp_search_context',{query:'nonexistent'})),[])
const beforeEvents=session.snapshotEvents().length
assert.equal(beforeEvents,9,'tool execution does not prematurely mutate the Session surface')
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_REAL_TOOLS_PASS schemas=4 pipeline=true queue=true noPrematureReplace=true\n')
