/**
 * DSH-native CCR: arrival-time tool output offload into the *same Session log*.
 *
 * Executed at the documented tools/post-execute waterfall BEFORE the canonical
 * tool/result is appended. A shortened result may leave the pipeline ONLY if
 * its original text has already been persisted through session/flush.
 * This does not intercept HTTP, global fetch, model prompts, or third-party tools.
 */
export const CCR_EVENT='plugin:dsh-docker-context-manager/ccr-result'
const DEFAULT_MIN=16000
const MAX_RECORD_BYTES=786432
const MAX_PAGE=8192
const REF=/^ccr:([1-9][0-9]{0,8})$/
function encodeRecord(record) {
  const encoded=JSON.stringify(record)
  if (!encoded || Buffer.byteLength(encoded,'utf8')>MAX_RECORD_BYTES)
    return null
  return JSON.parse(encoded)
}
function originalText(blocks) {
  return blocks.map(c=>c.text).join('\n')
}
export async function offloadCcr(exec,result,options) {
  const {
    appendRecord,flush,logger,minChars=DEFAULT_MIN,
  }=options
  const session=exec.agent?.session
  // Never offload failed/cancelled results, ACP control responses or nested
  // PTC calls. PTC retains canonical programmatic values independently, and
  // needs a separately scoped copy-projection policy.
  if(!session||result.isError||exec.parent||/^acp_/.test(exec.name)
    ||!Array.isArray(result.content)
    ||result.content.length===0
    ||!result.content.every(c=>c?.type==='text'&&typeof c.text==='string'))
    return null
  const value=originalText(result.content)
  if(value.length<minChars)return null
  const record=encodeRecord({
    version:1,tool:exec.name,callId:String(exec.callId),
    content:result.content,characters:value.length,
  })
  if(!record)return null // Never silently truncate unspoolable results.
  if(typeof appendRecord!=='function'||typeof flush!=='function')return null
  try {
    const seq=appendRecord(session,CCR_EVENT,record)
    const durable=await flush(session)
    if(durable!==true){
      logger?.warn?.('CCR has no durable native Session writer; preserving original tool result')
      return null
    }
    return {
      ref:'ccr:'+seq,
      content:[{type:'text',text:
        '[Native CCR: a '+value.length+'-character tool result was stored in the same DSH Session event log at ccr:'+seq+'. '
        +'Read it using acp_ccr_retrieve({ref:"ccr:'+seq+'",offset:0,limit:4096}). '
        +'Original tool text is NOT discarded.]\n'+value.slice(0,192)}],
    }
  }catch(error) {
    logger?.warn?.('CCR offload refused, unmodified tool result retained: '+String(error?.message??error))
    return null
  }
}
export function retrieveCcr(session,{ref,offset=0,limit=4096}={}) {
  const match=typeof ref==='string'?REF.exec(ref):null
  if(!match)throw Error('invalid native CCR ref')
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000000
    ||!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)
    throw Error('invalid native CCR paging arguments')
  const event=session.eventAt(Number(match[1]))
  if(event?.type!==CCR_EVENT||event.ignorable!==true
    ||event.data?.version!==1
    ||!Array.isArray(event.data.content)
    ||!event.data.content.every(c=>c?.type==='text'&&typeof c.text==='string'))
    throw Error('native CCR record unavailable in this Session')
  // No cross-session locator resolution. The current Agent's Session is the
  // ONLY resource from which a retrieval can be authorized and performed.
  const blocks=event.data.content
  const text=originalText(blocks)
  const page=text.slice(offset,offset+limit)
  return {ref,tool:event.data.tool,characters:text.length,offset,
    content:page,nextOffset:offset+page.length<text.length?offset+page.length:null}
}
