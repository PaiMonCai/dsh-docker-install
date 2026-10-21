import { createHash } from 'node:crypto'
import { applyRetrieve, createContentStore, hashContent } from 'acp-kernel'

export const CCR_EVENT='plugin:dsh-docker-context-manager/ccr-result'
const CANONICAL=/^dshccr:v2:([a-f0-9]{16}):(0|[1-9][0-9]{0,8})$/
const LEGACY=/^ccr:(0|[1-9][0-9]{0,8})$/
const MAX_RECORD_BYTES=786432
const SESSION_BUDGET=32*1024*1024
export const KERNEL_STORE_REF='m00001'
const textOf=blocks=>blocks.map(c=>c.text).join('\n')
const scopeOf=session=>createHash('sha256').update(String(session.id)).digest('hex').slice(0,16)
const canonical=event=>'dshccr:v2:'+event.data.scope+':'+event.seq

export function readStoredOriginal(session,ref) {
  const modern=typeof ref==='string'?CANONICAL.exec(ref):null
  const old=typeof ref==='string'?LEGACY.exec(ref):null
  if(!modern&&!old)throw Error('invalid native CCR ref')
  const event=session.eventAt(Number(modern?modern[2]:old[1]))
  const data=event?.data
  if(event?.type!==CCR_EVENT||event.ignorable!==true
    ||!Array.isArray(data?.content)||!data.content.length
    ||!data.content.every(c=>c?.type==='text'&&typeof c.text==='string')
    ||(modern?(data.version!==2||data.scope!==modern[1]):data.version!==1))
    throw Error('native CCR record unavailable in this Session')
  const text=textOf(data.content)
  if(data.version===1)return {event,text}
  if(data.entry?.hash!==hashContent(text)||data.entry?.chars!==text.length)
    throw Error('native CCR original integrity mismatch')
  const store=createContentStore()
  store.byRef[KERNEL_STORE_REF]=data.entry
  store.byHash[data.entry.hash]=text
  const found=applyRetrieve({store,ref:KERNEL_STORE_REF})
  if(!found.ok||found.text!==text)throw Error('native CCR original unavailable')
  return {event,text:found.text,entry:found.entry}
}

export class ContentStorePort {
  constructor({appendRecord,flush,maxSessionBytes=SESSION_BUDGET}={}) {
    this.appendRecord=appendRecord
    this.flush=flush
    this.maxSessionBytes=maxSessionBytes
  }
  putOriginal(session,{tool,callId,content,entry}) {
    if(typeof this.appendRecord!=='function'||typeof this.flush!=='function')return null
    const text=textOf(content)
    const events=session.snapshotEvents().filter(e=>e.type===CCR_EVENT)
    const previous=events.findLast(e=>e.data?.version===2&&e.data.callId===callId
      &&e.data.scope===scopeOf(session))
    if(previous) {
      if(previous.data.entry?.hash!==hashContent(text)||JSON.stringify(previous.data.content)!==JSON.stringify(content))
        return null
      return canonical(previous)
    }
    const record=JSON.parse(JSON.stringify({version:2,scope:scopeOf(session),tool,callId,
      content,characters:text.length,entry}))
    const bytes=Buffer.byteLength(JSON.stringify(record),'utf8')
    if(bytes>MAX_RECORD_BYTES||events.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e.data),'utf8'),0)+bytes>this.maxSessionBytes)
      return null
    const seq=this.appendRecord(session,CCR_EVENT,record)
    if(!Number.isSafeInteger(seq)||seq<0)throw Error('invalid native CCR sequence')
    return 'dshccr:v2:'+record.scope+':'+seq
  }
  async commitBarrier(session) { return await this.flush(session)===true }
  getOriginal(session,{ref,offset=0,limit=4096}={}) {
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000000
      ||!Number.isSafeInteger(limit)||limit<1||limit>8192)
      throw Error('invalid native CCR paging arguments')
    const {event,text}=readStoredOriginal(session,ref)
    const page=text.slice(offset,offset+limit)
    return {ref,tool:event.data.tool,characters:text.length,offset,content:page,
      nextOffset:offset+page.length<text.length?offset+page.length:null}
  }
}
