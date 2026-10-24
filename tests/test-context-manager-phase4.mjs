import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {indexCompactions, publicIndex, summaryDetail, originalPage, LIMITS} from '../docker/plugins/dsh-context-manager/history-index.mjs'
import {apply,ENDPOINT} from '../docker/plugins/dsh-context-manager/index.js'

const msg=(seq,text)=>({seq,type:'user/message',time:1000+seq,data:{role:'user',
  source:{kind:'user'},content:[{type:'text',text}]}})
function fixture(){
  return {meta:{id:'session-test',agentPreset:'standard'},events:[
    msg(0,'SECRET-SOURCE text for original retrieval'),msg(1,'Latest user target'),
    {seq:2,type:'compaction/start',time:1002,data:{compactionId:'c1',turn:null}},
    {seq:3,type:'compaction/summary',time:1003,data:{compactionId:'c1',
      summary:[{type:'text',text:'## Context Tier: T1\n## User Goals\n- keep working'}],
      shadowedRange:{start:0,end:1},shadowedSeqs:[0,1],
      shadowedTokenCount:1200,provider:'test',model:'model'}},
    {seq:4,type:'user/message',time:1004,data:{source:{kind:'compact-checkpoint',compactionId:'c1'},
      content:[{type:'text',text:'<compacted-summary>\n## Context Tier: T1'}]},
      sourceEventSeqs:[2,3,0,1],surfaceOp:{op:'replace',startSeq:0,endSeq:1}},
    {seq:5,type:'compaction/end',time:1005,data:{compactionId:'c1',turn:null}},
  ]}
}
test('index only fully closed DSH compaction, preserving actual non-interval source refs',()=>{
  const data=fixture(),before=structuredClone(data)
  const idx=indexCompactions(data)
  assert.equal(idx.total,1)
  assert.equal(idx.incomplete,0)
  assert.equal(idx.rows[0].tier,'T1')
  assert.deepEqual(idx.rows[0].sourceSeqs,[0,1])
  assert.equal(idx.revision,6)
  const list=publicIndex(idx,{})
  assert.equal(list.items.length,1)
  assert.equal(list.items[0].sourceCount,2)
  assert.ok(!JSON.stringify(list).includes('SECRET-SOURCE'))
  assert.deepEqual(summaryDetail(idx,3).sourceSeqs,[0,1])
  assert.equal(summaryDetail(idx,99),null)
  assert.deepEqual(data,before)
})
test('original retrieval requires explicit summary and matching durable event revision',()=>{
  const data=fixture(),idx=indexCompactions(data)
  const page=originalPage(data,idx,{summarySeq:3,revision:6,offset:0,limit:1})
  assert.equal(page.items[0].seq,0)
  assert.match(page.items[0].text,/SECRET-SOURCE/)
  assert.equal(page.nextOffset,1)
  assert.equal(originalPage(data,idx,{summarySeq:3,revision:6,offset:1,limit:1}).items[0].seq,1)
  assert.throws(()=>originalPage(data,idx,{summarySeq:3,revision:7}),/history changed/)
  assert.throws(()=>originalPage(data,idx,{summarySeq:3,revision:6,limit:99}),/pagination/)
})
test('failed, interrupted, invalid-adjacent and malformed compactions never appear successful',()=>{
  let d=fixture();d.events[5].data.error='cancelled'
  assert.equal(indexCompactions(d).total,0)
  assert.equal(indexCompactions(d).incomplete,1)
  d=fixture();d.events.pop()
  assert.equal(indexCompactions(d).incomplete,1)
  d=fixture();d.events[4].sourceEventSeqs=[2,3]
  assert.equal(indexCompactions(d).total,0)
  d=fixture();d.events[3].data.shadowedSeqs=[1,1]
  assert.equal(indexCompactions(d).total,0)
  d=fixture();d.events=Array.from({length:LIMITS.events+1},(_,seq)=>({seq,type:'other'}))
  assert.throws(()=>indexCompactions(d),/event budget/)
})
test('raw retrieval allowlists event types and never serializes sensitive headers',()=>{
  const d=fixture();d.events[0]={seq:0,type:'request/header',time:1000,data:{apiKey:'secret-key'}}
  const idx=indexCompactions(d)
  const result=originalPage(d,idx,{summarySeq:3,revision:6})
  assert.equal(result.items[0].text,'[不展示该事件类型的原始内容]')
  assert.ok(!JSON.stringify(result).includes('secret-key'))
  assert.equal(publicIndex(idx,{query:'User Goals'}).total,1)
  assert.equal(publicIndex(idx,{query:'no-result'}).total,0)
  assert.throws(()=>publicIndex(idx,{limit:100}),/pagination/)
  assert.throws(()=>publicIndex(idx,{query:'q'.repeat(90)}),/query/)
})
function harness(){
  const handlers=new Map()
  let reads=0
  const controller={
    async list(){return {items:[{sessionId:'session-test',agentPreset:'standard',updatedAt:10}]}},
    async inspect(id){reads++;assert.equal(id,'session-test');return fixture()},
  }
  apply({on(){},get(key){return key==='sessionController'?controller:undefined},
    logger:{warn(){}},inject(_deps,fn){fn({connection:{rpc:{handle(path,handler){handlers.set(path,handler)}}}})}})
  return {call:handlers.get(ENDPOINT),reads:()=>reads}
}
test('default-off RPC refuses Session reads without invoking persistence',async()=>{
  const prev=process.env.DSH_CONTEXT_MANAGER_HISTORY_READ
  delete process.env.DSH_CONTEXT_MANAGER_HISTORY_READ
  try{
    const api=harness()
    assert.equal((await api.call('history-capabilities',{})).value.enabled,false)
    const r=await api.call('history-index',{sessionId:'session-test'})
    assert.equal(r.ok,false);assert.equal(r.error.code,'history_disabled')
    assert.equal(api.reads(),0)
  }finally{
    if(prev===undefined)delete process.env.DSH_CONTEXT_MANAGER_HISTORY_READ
    else process.env.DSH_CONTEXT_MANAGER_HISTORY_READ=prev
  }
})
test('owner opt-in RPC cold-replays, searches, inspects and pages original sources',async()=>{
  const prev=process.env.DSH_CONTEXT_MANAGER_HISTORY_READ
  process.env.DSH_CONTEXT_MANAGER_HISTORY_READ='owner-only'
  try{
    const api=harness()
    assert.equal((await api.call('history-capabilities',{})).value.enabled,true)
    assert.equal((await api.call('history-sessions',{})).value.items[0].sessionId,'session-test')
    assert.equal((await api.call('history-index',{sessionId:'../etc'})).ok,false)
    const list=await api.call('history-index',{sessionId:'session-test'})
    assert.equal(list.ok,true);assert.equal(list.value.total,1)
    assert.ok(!JSON.stringify(list.value).includes('SECRET-SOURCE'))
    const summary=await api.call('history-summary',{sessionId:'session-test',summarySeq:3})
    assert.equal(summary.value.tier,'T1')
    const originals=await api.call('history-originals',{
      sessionId:'session-test',summarySeq:3,revision:list.value.revision,limit:5})
    assert.match(originals.value.items[0].text,/SECRET-SOURCE/)
    assert.equal(api.reads(),3)
    assert.equal((await api.call('history-originals',{
      sessionId:'session-test',summarySeq:3,revision:100})).ok,false)
  }finally{
    if(prev===undefined)delete process.env.DSH_CONTEXT_MANAGER_HISTORY_READ
    else process.env.DSH_CONTEXT_MANAGER_HISTORY_READ=prev
  }
})
test('Web settings only retrieves original content after explicit interaction, CI compiles',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
  const client=read('docker/plugins/dsh-context-manager/client.js')
  assert.match(client,/压缩历史与原文回取/)
  assert.match(client,/按需回取原文/)
  assert.match(client,/history-capabilities/)
  assert.match(client,/history-originals/)
  assert.match(read('Dockerfile'),/history-index.mjs/)
  assert.match(read('.github/workflows/build.yml'),/test-context-manager-phase4.mjs/)
  assert.match(read('.github/workflows/build-reverse.yml'),/test-context-manager-phase4.mjs/)
})
