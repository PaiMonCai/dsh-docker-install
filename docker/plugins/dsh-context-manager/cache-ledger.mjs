import { buildCacheReport, formatCacheReport, defaultCountTokens } from 'acp-kernel'
import { indexCompactions } from './history-index.mjs'

import {normalizeProviderUsage} from './provider-usage.mjs'
export {normalizeProviderUsage} from './provider-usage.mjs'

const counter=value=>Number.isSafeInteger(value)&&value>=0?value:null

function messageOf(event) { return event?.type==='user/message'?event.data:event?.data?.message }
function textTokens(event) {
  return (messageOf(event)?.content??[]).reduce((n,c)=>n+(c.type==='text'?defaultCountTokens(c.text)
    :c.type==='tool-call'?defaultCountTokens(c.arguments??''):0),0)
}
function hasUnmeasuredMedia(event) {
  return !event||(messageOf(event)?.content??[]).some(c=>!['text','tool-call'].includes(c.type))
}
const safeRoute=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:'unknown'

/** Read only the caller's native log. No raw message, tool text or credential is returned. */
export function readSessionCacheLedger(session,{detail='summary',priceProfile,streamTimings}={}) {
  if(!['summary','full'].includes(detail))throw Error('invalid cache ledger detail')
  if(priceProfile&&(Object.keys(priceProfile).some(k=>!['w','r','q'].includes(k))
    ||Object.values(priceProfile).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)))
    throw Error('invalid cache price profile')
  const events=session.snapshotEvents()
  const indexed=indexCompactions({meta:{id:session.id},events})
  const validFolds=new Map(indexed.rows.map(row=>[row.summarySeq,row]))
  const bySeq=new Map(events.map(event=>[event.seq,event]))
  let surface=[],route={provider:'unknown',model:'unknown'},series=0,clock=0,current=null
  const groups=[],folds=[],pending=[],unattributed=[]
  let attemptsWithoutUsage=0
  const clear=reason=>{
    for(const item of pending)unattributed.push({seq:item.fold.seq,reason})
    current=null;pending.length=0
  }
  const routeKey=(r,origin)=>JSON.stringify([r.provider,r.model,series,origin])
  for(const event of events) {
    // Preserve event ordering even when several events share a millisecond.
    clock=Math.max(counter(event.time)??0,clock+0.001)
    if(event.type==='request/context'||event.type==='request/header') {
      const next=event.type==='request/context'?event.data:event.data?.header?.config
      if(next?.provider&&next?.model) {
        const resolved={provider:safeRoute(next.provider),model:safeRoute(next.model)}
        if(JSON.stringify(resolved)!==JSON.stringify(route))clear('route-boundary')
        route=resolved
      }
      if(event.data?.startsSeries){series++;clear('request-series-boundary')}
    }
    const origin=event.seq<(session.firstLiveSeq??0)?'inherited':'live'
    if(validFolds.has(event.seq)) {
      const row=validFolds.get(event.seq),start=surface.indexOf(row.sourceSeqs[0])
      const prefix=surface.slice(0,start)
      const measured=counter(event.data.shadowedTokenCount)
      const complete=start>=0&&measured!==null&&!prefix.some(seq=>hasUnmeasuredMedia(bySeq.get(seq)))
        &&current?.key===routeKey(route,origin)
      const fold={seq:event.seq,eventTime:event.time,at:clock,tokensCompressed:measured,
        summaryTokens:defaultCountTokens(row.summary),measurement:'native/local-token-estimate',
        ...(complete?{firstFoldStartTokens:prefix.reduce((n,seq)=>n+textTokens(bySeq.get(seq)),0)}:{}),
        attribution:complete?'estimated-divergence-clamp':'unattributed-missing-prefix-measurement-or-prior-usage'}
      folds.push(fold)
      if(complete)pending.push({key:routeKey(route,origin),fold})
      else unattributed.push({seq:event.seq,reason:fold.attribution})
    }
    if(event.type==='assistant/attempt'){attemptsWithoutUsage++;clear('unsettled-provider-attempt')}
    if(event.type==='assistant/message') {
      const source=event.data.message?.source
      const actual={provider:safeRoute(source?.provider??route.provider),model:safeRoute(source?.model??route.model)}
      const normalized=normalizeProviderUsage(event.data.usage)
      const key=routeKey(actual,origin)
      const timing=streamTimings?.(event.data.stream)??null
      const observed={seq:event.seq,eventTime:event.time,origin,...normalized,timing}
      if(!normalized.known||actual.provider==='unknown'||actual.model==='unknown') {
        groups.push({provider:actual.provider,model:actual.model,series,origin,kind:'unknown',observed,
          reason:normalized.reason??'route-unknown'})
        clear('unknown-provider-usage')
      } else {
        if(!current||current.key!==key) {
          current={key,provider:actual.provider,model:actual.model,series,origin,kind:'measured',samples:[],folds:[],observed:[]}
          groups.push(current)
        }
        current.samples.push({at:clock,input:normalized.input,cached:normalized.cached,output:normalized.output})
        current.observed.push(observed)
        current.folds.push(...pending.filter(item=>item.key===key).map(item=>item.fold))
        for(const item of pending.filter(item=>item.key!==key))unattributed.push({seq:item.fold.seq,reason:'model-or-session-boundary'})
        pending.length=0
      }
    }
    const op=event.surfaceOp
    if(op==='append'||op?.op==='append')surface.push(event.seq)
    if(op?.op==='replace') {
      const first=surface.indexOf(op.startSeq),last=surface.indexOf(op.endSeq)
      if(first>=0&&last>=first)surface.splice(first,last-first+1,event.seq)
      else surface=[]
    }
  }
  clear('no-following-complete-usage')
  const measured=groups.filter(group=>group.kind==='measured')
  const rendered=groups.map(group=>{
    if(group.kind==='unknown')return group
    const report=buildCacheReport(group.samples,group.folds,{priceProfile,maxLines:detail==='full'?50:1})
    return {provider:group.provider,model:group.model,series:group.series,origin:group.origin,kind:group.kind,
      report:detail==='full'?report:{totals:report.totals,economics:report.economics,profile:report.profile,folds:report.folds.slice(-10)},
      formatted:formatCacheReport(report),
      observed:detail==='full'?group.observed.slice(-50):undefined}
  })
  return {schemaVersion:1,scope:'current-native-session',readOnly:true,requestsObserved:groups.reduce((n,g)=>n+(g.samples?.length??1),0),
    requestsWithCompleteUsage:measured.reduce((n,g)=>n+g.samples.length,0),unknownRequests:groups.filter(g=>g.kind==='unknown').length,
    attemptsWithoutUsage,groups:rendered.slice(-32),groupsOmitted:Math.max(0,rendered.length-32),
    folds:folds.slice(-50),unattributedFolds:unattributed.slice(-50),incompleteCompactions:indexed.incomplete,
    priceSource:priceProfile?'explicit-relative-price-profile':'upstream-default-relative-price-profile',
    currency:null,economicsAreEstimates:true,providerExperimentAccepted:false,
    caveats:['Unknown usage is excluded from hit-rate denominators and breaks sample continuity.',
      'Fold divergence and summary sizes are local estimates; relative cost units are not a bill.',
      'Explicit request-series boundaries break fold attribution; attempt streams are not counted as settled requests.',
      'Absent provider latency and absent cache fields remain unknown.']}
}
