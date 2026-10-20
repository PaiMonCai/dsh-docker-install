/**
 * Model-facing ACP tools inside the SAME isolated Standard preset as its
 * unique native CompactionEngine. This file is never loaded by default.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { AcpRuntime } from './acp-runtime.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const [{defineTool},{appendPluginRecord}]=await Promise.all([
  import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-tools')).href),
  import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href),
])
export const name='dsh-context-manager-acp'
export const inject=['tools','compaction','sessions','systemPrompt']
function textOutput() {return {schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]}}
function printable(value) {return JSON.stringify(value)}
export function apply(ctx) {
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,
    flushIntent:session=>ctx.sessions.flush(session),logger:ctx.logger})
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
    'List current ACP message refs, active compression blocks, pressure and pending compression. Call before acp_compress. Do not invent refs.',
    {},(_args,exec)=>runtime.status(exec.agent.session))
  tool('acp_compress',
    'Queue a user/assistant-written summary for a current m-ref range; it is committed at the next safe DSH agent/pre-step. Confirm with acp_status. Preserve tool pairs.',
    {startRef:{type:'string',required:true},endRef:{type:'string',required:true},
      summary:{type:'string',required:true},topic:{type:'string'}},
    (args,exec)=>runtime.propose(exec.agent.session,args))
  tool('acp_decompress',
    'Read original event-log content from a compressed ACP block without expanding the active model prompt. Returns bounded untrusted historical text.',
    {blockId:{type:'string',required:true}},
    (args,exec)=>runtime.decompress(exec.agent.session,args.blockId))
  tool('acp_search_context',
    'Search summaries of native ACP blocks; use acp_decompress to inspect a selected original range.',
    {query:{type:'string',required:true}},
    (args,exec)=>runtime.search(exec.agent.session,args.query))

  // A tool call is still unsettled while it is executing. DSH's next
  // pre-step has completed the tool/result pair, so use that boundary to
  // enter the upstream compaction transaction. The existing Basic engine
  // is configured with auto=false in this explicit ACP pilot.
  ctx.on('agent/pre-step',async ({agent,signal},next)=>{
    if(agent?.session){
      try { await runtime.processPending(agent,ctx.compaction,signal) }
      catch(error) {ctx.logger?.warn?.('ACP proposal was not committed: '+String(error?.message??error))}
    }
    return next()
  })
}
