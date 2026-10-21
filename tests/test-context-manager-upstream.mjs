import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Session, SessionId, appendPluginRecord } from '../ci/acp-kernel-audit/compatibility.mjs'
import { AcpRuntime } from '../docker/plugins/dsh-context-manager/acp-runtime.mjs'
import { offloadCcr,retrieveCcr,CCR_EVENT } from '../docker/plugins/dsh-context-manager/acp-ccr.mjs'
import { buildStoredPlaceholder } from '../docker/plugins/dsh-context-manager/node_modules/acp-kernel/dist/index.js'
import { renderNudgeText,searchBlocks,blockDocs } from '../docker/plugins/dsh-context-manager/node_modules/acp-kernel/dist/index.js'
import {nativePrompts,nativeGuidance,nativeNudgeSections} from '../docker/plugins/dsh-context-manager/acp-prompts.mjs'
import * as pending from '../docker/plugins/dsh-context-manager/acp-pending.mjs'
import { transaction } from './lib/context-manager-legacy-probe.mjs'

test('native kernel distribution is pinned to the verified source and lockfile', async () => {
  const root = new URL('../docker/plugins/dsh-context-manager/', import.meta.url)
  const provenance = JSON.parse(await readFile(new URL('vendor/provenance.json', root), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  const data = await readFile(new URL('vendor/' + provenance.artifact, root))
  assert.equal(createHash('sha256').update(data).digest('hex'), provenance.sha256)
  assert.equal(lock.packages['node_modules/acp-kernel'].integrity, provenance.integrity)
  assert.equal(provenance.upstream.commit, 'bc4a3f87e2dc98e82df6f707d362e75492fdf3d1')
  assert.equal(provenance.reproducibleCleanBuild, true)
})

function populated(id, content) {
  const session = Session.create(SessionId(id))
  for(let i=0;i<7;i++) session.append('user/message', {
    id: id+'-'+i, role:'user', source:{kind:'user'},
    content: i===1&&content?content:[{type:'text',text:'Original native safety evidence. '.repeat(90)}],
  }, {surfaceOp:'append'})
  return session
}

test('native range refuses media before writing an intent or mutating the surface', () => {
  const session=populated('m1-media',[{type:'image',url:'https://example.invalid/synthetic.png'}])
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const before=JSON.stringify(session.snapshotEvents())
  assert.throws(()=>runtime.propose(session,{startRef:refs[0].ref,endRef:refs[3].ref,
    summary:'Preserve the full original native evidence and the image without silently hiding non-text data. '.repeat(2)}), /protected|kernel rejected/)
  assert.equal(JSON.stringify(session.snapshotEvents()),before)
})

test('upstream parser accepts legacy boundary spellings without mutating request arguments', () => {
  const session=populated('m1-parser')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const args={startId:refs[0].ref,endId:refs[2].ref,
    summary:'Original native evidence is preserved by the upstream parser and an explicitly bounded DSH transaction. '.repeat(2)}
  const before=JSON.stringify(args)
  assert.equal(runtime.propose(session,args).accepted,true)
  assert.equal(JSON.stringify(args),before)
})

const originalResult=()=>({isError:false,content:[{type:'text',text:JSON.stringify({rows:Array.from({length:800},(_,i)=>({i,value:'exact synthetic original'}))})}]})
const ccrExec=session=>({agent:{session},name:'read_file',callId:'one-call',arguments:{path:'/synthetic'}})
const durable={appendRecord:appendPluginRecord,flush:async()=>true}

test('CCR matches upstream placeholder fields, preserves exact JSON and isolates colliding event sequences', async () => {
  const session=Session.create(SessionId('m2-first')),other=Session.create(SessionId('m2-other'))
  const original=originalResult(),before=structuredClone(original)
  const saved=await offloadCcr(ccrExec(session),original,durable)
  assert.ok(saved)
  const event=session.snapshotEvents().find(e=>e.type===CCR_EVENT)
  assert.equal(event.data.version,2)
  assert.equal(saved.content[0].text,buildStoredPlaceholder({ref:saved.ref,...event.data.entry,retrieveToolName:'acp_ccr_retrieve'}))
  const pieces=[]
  for(let offset=0;;){const page=retrieveCcr(session,{ref:saved.ref,offset,limit:8192});pieces.push(page.content);if(page.nextOffset===null)break;offset=page.nextOffset}
  assert.equal(pieces.join(''),original.content[0].text)
  const another=await offloadCcr(ccrExec(other),original,durable)
  assert.notEqual(saved.ref,another.ref)
  assert.throws(()=>retrieveCcr(other,{ref:saved.ref}),/unavailable/)
  assert.deepEqual(original,before)
  const cold=Session.create(session.id,session.snapshotEvents(),session.header)
  assert.equal(retrieveCcr(cold,{ref:saved.ref}).content,original.content[0].text.slice(0,4096))
})

test('CCR waits for durability and retries without allocating a second reference', async () => {
  const session=Session.create(SessionId('m2-barrier')),result=originalResult()
  let release
  const barrier=new Promise(resolve=>{release=resolve})
  let settled=false
  const pending=offloadCcr(ccrExec(session),result,{appendRecord:appendPluginRecord,flush:()=>barrier}).then(value=>{settled=true;return value})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(settled,false)
  release(false)
  assert.equal(await pending,null)
  const saved=await offloadCcr(ccrExec(session),result,durable)
  const retry=await offloadCcr(ccrExec(session),result,durable)
  assert.equal(saved.ref,retry.ref)
  assert.deepEqual(saved.content,retry.content)
  assert.equal(session.snapshotEvents().filter(e=>e.type===CCR_EVENT).length,1)
  const changed=structuredClone(result);changed.content[0].text+='changed'
  assert.equal(await offloadCcr(ccrExec(session),changed,durable),null)
})

test('CCR preserves unsupported, nested, cancelled and unspoolable results without partial shortening', async () => {
  for(const mode of ['media','nested','cancelled','failed','disk','quota','oversized']) {
    const session=Session.create(SessionId('m2-'+mode)),exec=ccrExec(session),result=originalResult()
    const options={...durable}
    if(mode==='media')result.content.push({type:'image',url:'https://example.invalid/image.png'})
    if(mode==='nested')exec.parent={callId:'parent'}
    if(mode==='cancelled')exec.signal=AbortSignal.abort()
    if(mode==='failed')result.isError=true
    if(mode==='disk')options.flush=async()=>{throw Error('synthetic disk full')}
    if(mode==='quota')options.maxSessionBytes=1
    if(mode==='oversized')result.content[0].text='x'.repeat(900000)
    const before=structuredClone(result)
    assert.equal(await offloadCcr(exec,result,options),null,mode)
    assert.deepEqual(result,before)
  }
})

test('optional upstream truncate/crush projections keep the durable original readable', async () => {
  for(const projection of ['truncate','crush']) {
    const session=Session.create(SessionId('m2-projection-'+projection))
    session.append('request/context',{provider:'synthetic',model:'offline',contextWindow:8192})
    const result=originalResult()
    const saved=await offloadCcr(ccrExec(session),result,{...durable,projection})
    assert.ok(saved)
    assert.ok(saved.content[0].text.length<result.content[0].text.length)
    if(projection==='truncate')assert.match(saved.content[0].text,/truncated for context space/)
    assert.equal(retrieveCcr(session,{ref:saved.ref,limit:8192}).content,result.content[0].text.slice(0,8192))
  }
})

test('absorb queues the complete native pair and rejects duplicated call identities', () => {
  for(const duplicate of [false,true]) {
    const session=Session.create(SessionId('m2-absorb-'+duplicate))
    const call=()=>session.append('assistant/message',{turn:1,step:1,stream:[],message:{
      id:'call-'+session.seq,role:'assistant',source:{kind:'model',provider:'offline',model:'offline'},
      content:[{type:'tool-call',id:'pair1',name:'read_file',arguments:'{}'}],
    }},{surfaceOp:'append'})
    call();if(duplicate)call()
    session.append('tool/result',{turn:1,step:1,message:{id:'result',role:'tool',toolCallId:'pair1',
      content:[{type:'text',text:'Native tool facts and exact source constraints. '.repeat(300)}],source:{kind:'tool'}}},{surfaceOp:'append'})
    for(let i=0;i<4;i++)session.append('user/message',{id:'tail-'+i,role:'user',source:{kind:'user'},
      content:[{type:'text',text:'Keep the current request visible.'}]},{surfaceOp:'append'})
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
    const {refs}=runtime.status(session)
    const args={ref:refs[duplicate?2:1].ref,summary:'The tool confirmed the exact source constraints and native event provenance. Keep all original facts recoverable from the same Session. '.repeat(2)}
    if(duplicate)assert.throws(()=>runtime.proposeAbsorb(session,args),/unambiguous/)
    else assert.equal(runtime.proposeAbsorb(session,args).accepted,true)
    assert.equal(session.snapshotEvents().filter(e=>e.type.includes('acp-state')).length,0)
  }
})

test('batch compression prevalidates disjoint ranges and commits separate recoverable native transactions', async () => {
  const session=populated('m3-batch')
  for(let i=0;i<5;i++)session.append('user/message',{id:'extra-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Further original source facts. '.repeat(80)}]},{surfaceOp:'append'})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  const {refs}=runtime.status(session)
  const summary='Preserve the original source facts, the native transaction boundary, every constraint and all remaining objectives. '.repeat(2)
  assert.throws(()=>runtime.proposeBatch(session,{content:[
    {startId:refs[0].ref,endId:refs[3].ref,summary},
    {startId:refs[2].ref,endId:refs[5].ref,summary},
  ]}),/overlap/)
  assert.equal(runtime.status(session).pending,false)
  assert.equal(runtime.proposeBatch(session,{content:[
    {startId:refs[0].ref,endId:refs[2].ref,summary},
    {startId:refs[3].ref,endId:refs[5].ref,summary},
  ]}).batchQueued,2)
  assert.equal((await runtime.processPending({session},transaction(session,pending))).batchCommitted,2)
  const cold=new AcpRuntime({appendRecord:appendPluginRecord})
  assert.equal(cold.status(Session.create(session.id,session.snapshotEvents(),session.header)).blocks.length,2)
})

test('upstream nudge is byte-identical and repeated status reads do not consume its cadence', () => {
  const session=populated('m3-nudge')
  session.append('request/context',{provider:'offline',model:'tiny',contextWindow:8192})
  for(let i=0;i<3;i++)session.append('user/message',{id:'large-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Large consumed native evidence. '.repeat(2500)}]},{surfaceOp:'append'})
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  runtime.status(session)
  const view=runtime.view(session)
  assert.equal(view.nudge.shouldInject,true)
  const text=runtime.nudgeMessage(session)
  assert.equal(text,renderNudgeText(view.nudge,nativePrompts,nativeNudgeSections).text)
  runtime.status(session)
  assert.equal(runtime.nudgeMessage(session),text)
  assert.ok(nativeGuidance.includes(nativePrompts.howToCompressRules))
  assert.doesNotMatch(nativeGuidance,/injected by the proxy/)
})

test('short English and Chinese searches preserve upstream scores and cannot query another Session', async () => {
  const session=populated('m3-search')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true})
  const {refs}=runtime.status(session)
  runtime.propose(session,{startRef:refs[0].ref,endRef:refs[2].ref,
    summary:'nebulazeta, connection pool, \u8fde\u63a5\u6c60: retain exact request boundaries and recover original evidence from the native Session log. '.repeat(2)})
  await runtime.processPending({session},transaction(session,pending))
  const {row}=runtime.view(session)
  for(const algorithm of ['hybrid','bm25','fuzzy','substring'])for(const query of ['nebulazeta','\u8fde\u63a5\u6c60']) {
    const expected=searchBlocks(blockDocs({...row.state,blocks:row.state.blocks.filter(b=>b.active)}),query,{algorithm,limit:10})
    const actual=runtime.search(session,query,{algorithm})
    assert.deepEqual(actual.map(hit=>({id:hit.id,score:hit.score})),expected.map(hit=>({id:hit.blockId,score:hit.score})))
  }
  assert.equal(runtime.search(session,'nebulazeta').length,1)
  assert.deepEqual(runtime.search(populated('m3-search-unrelated'),'nebulazeta'),[])
})
