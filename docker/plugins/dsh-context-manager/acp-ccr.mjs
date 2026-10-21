/** Arrival-time upstream CCR, committed through the original DSH Session. */
import {
  createInitialState, createContentStore, defaultConfig, defaultCountTokens,
  storeLargeResults, buildStoredPlaceholder, parseStoredPlaceholder,
  truncateLargeToolOutputs, applyCrushToMessages,
} from 'acp-kernel'
import { ContentStorePort, KERNEL_STORE_REF } from './content-store-port.mjs'
export { CCR_EVENT, ContentStorePort } from './content-store-port.mjs'

export async function offloadCcr(exec,result,options={}) {
  const {appendRecord,flush,logger,minChars,maxSessionBytes,projection='retrieve'}=options
  const session=exec.agent?.session
  if(!['retrieve','truncate','crush'].includes(projection)||!session||typeof exec.name!=='string'
    ||result.isError||exec.parent||/^acp_|^(compress|decompress|retrieve|search_context)$/.test(exec.name)
    ||exec.signal?.aborted||!exec.callId||!Array.isArray(result.content)||!result.content.length
    ||!result.content.every(c=>c?.type==='text'&&typeof c.text==='string'))return null
  try {
    const text=result.content.map(c=>c.text).join('\n')
    if(Buffer.byteLength(JSON.stringify(result.content),'utf8')>786432)return null
    const state=createInitialState()
    state.messageRefs={byRaw:{arrival:KERNEL_STORE_REF},byRef:{[KERNEL_STORE_REF]:'arrival'}}
    const config=defaultConfig(200000,{ccr:{enabled:true,toolName:'acp_ccr_retrieve',
      ...(minChars===undefined?{}:{minToolTokens:Math.ceil(minChars/4)})}})
    const projected=storeLargeResults({state,store:createContentStore(),config,countTokens:defaultCountTokens,
      messages:[{id:'call',role:'assistant',contentType:'tool-call',toolName:exec.name,
        toolCallId:String(exec.callId),text:JSON.stringify(exec.arguments??{})},
      {id:'arrival',role:'tool',contentType:'tool-result',toolName:exec.name,
        toolCallId:String(exec.callId),text}]})
    if(projected.storedCount!==1)return null
    const entry=projected.store.byRef[KERNEL_STORE_REF]
    const parsed=parseStoredPlaceholder(projected.messages.at(-1).text)
    if(parsed?.ref!==KERNEL_STORE_REF)return null
    const port=new ContentStorePort({appendRecord,flush,maxSessionBytes})
    const ref=port.putOriginal(session,{tool:exec.name,callId:String(exec.callId),content:result.content,entry})
    if(!ref||!await port.commitBarrier(session)||exec.signal?.aborted)return null
    // Kernel's parser reserves mN. Only the host namespace is substituted;
    // classification, threshold, preview and placeholder rendering stay upstream.
    const pointer=buildStoredPlaceholder({
      ref,kind:entry.kind,tokens:entry.tokens,head:entry.head,command:entry.command,
      retrieveToolName:'acp_ccr_retrieve',
    })
    let reduced=''
    if(projection!=='retrieve') {
    const arrival={id:'arrival',role:'tool',contentType:'tool-result',toolName:exec.name,
      toolCallId:String(exec.callId),text}
    const window=session.requestContext?.()?.contextWindow??200000
    const tokenCount=defaultCountTokens(text)+session.surface.nodes.reduce((n,seq)=>{
      const event=session.eventAt(seq),message=event?.type==='user/message'?event.data:event?.data?.message
      return n+(message?.content??[]).reduce((sum,c)=>sum+(c.type==='text'?defaultCountTokens(c.text):0),0)
    },0)
    const reductionConfig=defaultConfig(window,{absorb:{enabled:true},crush:{enabled:true}})
    if(projection==='truncate')reduced=truncateLargeToolOutputs([arrival],tokenCount,reductionConfig,
      defaultCountTokens,{protectRecentMessages:0}).messages[0].text
    if(projection==='crush')reduced=applyCrushToMessages([arrival],reductionConfig,tokenCount,defaultCountTokens).messages[0].text
    }
    return {ref,content:[{type:'text',text:reduced&&reduced.length+pointer.length<text.length
      ?reduced+'\n\n'+pointer:pointer}]}
  }catch(error) {
    logger?.warn?.('CCR offload refused, unmodified tool result retained: '+String(error?.message??error))
    return null
  }
}

export function retrieveCcr(session,args) {
  return new ContentStorePort().getOriginal(session,args)
}
