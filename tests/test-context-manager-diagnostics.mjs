import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDiagnostics, diagnosticReason, LOG_PREFIX } from '../docker/plugins/dsh-context-manager/diagnostics.mjs'
import { AcpRuntime } from '../docker/plugins/dsh-context-manager/acp-runtime.mjs'
import * as pending from '../docker/plugins/dsh-context-manager/acp-pending.mjs'
import { offloadCcr } from '../docker/plugins/dsh-context-manager/acp-ccr.mjs'
import { Session, SessionId, appendPluginRecord, transaction } from '../ci/acp-kernel-audit/compatibility.mjs'
import { apply } from '../docker/plugins/dsh-context-manager/index.js'

function capture() {
  const lines=[]
  const write=line=>lines.push(line)
  return {logger:{info:write,warn:write,debug:write},lines,rows:()=>lines.map(line=>JSON.parse(line.slice(LOG_PREFIX.length)))}
}

test('diagnostics allow only bounded metadata and fingerprint raw identities',()=>{
  const output=capture()
  const log=createDiagnostics(output.logger,{level:'debug',budget:{start:null,written:0,suppressed:0},now:()=>123})
  assert.equal(log('tool.completed',{session:{id:'SECRET_SESSION'},provider:'SECRET_PROVIDER',model:'SECRET_MODEL',
    callId:'SECRET_CALL',tool:'retrieve',elapsedMs:1.23456,summary:'SECRET_SUMMARY',arguments:'SECRET_ARGUMENTS',
    content:'SECRET_TOOL_TEXT',reason:'SECRET_ERROR',originalChars:40000}),true)
  const row=output.rows()[0]
  assert.equal(row.event,'tool.completed')
  assert.match(row.sessionHash,/^[a-f0-9]{16}$/)
  assert.equal(row.elapsedMs,1.235)
  assert.equal(row.reason,'unknown')
  assert.ok(output.lines[0].length<2048)
  assert.ok(!output.lines[0].includes('SECRET'))
  assert.equal(log('toString',{content:'SECRET'}),false)
  assert.equal(diagnosticReason(Error('SECRET disk failed')),'durability')
})

test('levels, bounded rate and dropped-event accounting never expose discarded payloads',async()=>{
  const output=capture(),budget={start:null,written:0,suppressed:0}
  let at=0
  const log=createDiagnostics(output.logger,{level:'info',budget,limit:2,now:()=>at})
  assert.equal(log('request.usage',{input:10}),false)
  log('acp.committed');log('ccr.stored')
  assert.equal(log('acp.refused',{reason:'unknown'}),false)
  at=60000;log('plugin.boot')
  assert.equal(output.rows().at(-1).suppressed,1)
  assert.equal(createDiagnostics(output.logger,{level:'off'})('acp.refused'),false)
  assert.equal(createDiagnostics({info(){throw Error('logger unavailable')}})('plugin.boot'),false)
  createDiagnostics({async info(){throw Error('async logger unavailable')}})('plugin.boot')
  await new Promise(resolve=>setImmediate(resolve))
})

function session(id) {
  const value=Session.create(SessionId(id))
  for(let i=0;i<7;i++)value.append('user/message',{id:'source-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:'Synthetic original context with exact native ownership. '.repeat(50)}]},{surfaceOp:'append'})
  return value
}

test('ACP success is logged after the ACK barrier, and a broken logger cannot affect commit',async()=>{
  for(const broken of [false,true]) {
    const output=capture(),value=session('diagnostic-commit-'+broken)
    const logger=broken?{info(){throw Error('broken log sink')},warn(){throw Error('broken log sink')}}:output.logger
    const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>true,logger})
    const refs=runtime.status(value).refs
    runtime.propose(value,{startRef:refs[0].ref,endRef:refs[2].ref,
      summary:'The exact original evidence remains recoverable through the native Session and its durable compaction boundary. '.repeat(2)})
    await runtime.processPending({session:value},transaction(value,pending))
    assert.equal(runtime.status(value).blocks.length,1)
    if(!broken)assert.equal(output.rows().filter(row=>row.event==='acp.committed').length,1)
  }
  const output=capture(),value=session('diagnostic-ack-failure')
  let flushes=0
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord,flushIntent:async()=>++flushes===1,logger:output.logger})
  const refs=runtime.status(value).refs
  runtime.propose(value,{startRef:refs[0].ref,endRef:refs[2].ref,
    summary:'Do not log a committed ACP operation until the acknowledgement has actually passed its persistence barrier. '.repeat(2)})
  await assert.rejects(runtime.processPending({session:value},transaction(value,pending)),/state commit lacks durable/)
  assert.ok(!output.rows().some(row=>row.event==='acp.committed'))
  assert.equal(output.rows().at(-1).reason,'durability')
})

test('CCR logs success only after persistence and never logs the original result',async()=>{
  const output=capture(),value=session('diagnostic-ccr')
  const result={isError:false,content:[{type:'text',text:'SECRET_EXACT_TOOL_CONTENT '.repeat(1800)}]}
  const exec={agent:{session:value},name:'read_file',callId:'SECRET_CCR_CALL'}
  assert.equal(await offloadCcr(exec,result,{appendRecord:appendPluginRecord,flush:async()=>false,logger:output.logger}),null)
  assert.ok(!output.rows().some(row=>row.event==='ccr.stored'))
  const stored=await offloadCcr(exec,result,{appendRecord:appendPluginRecord,flush:async()=>true,logger:output.logger})
  assert.ok(stored)
  const row=output.rows().find(item=>item.event==='ccr.stored')
  assert.equal(row.originalChars,result.content[0].text.length)
  assert.ok(row.projectedChars<row.originalChars)
  assert.ok(!output.lines.join('').includes('SECRET'))
})

test('native event observation records unknown cache fields, retries and inherited usage without text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-context-log-'))
  const oldHome=process.env.DSH_HOME,oldLevel=process.env.DSH_CONTEXT_MANAGER_LOG_LEVEL
  process.env.DSH_HOME=root;process.env.DSH_CONTEXT_MANAGER_LOG_LEVEL='debug'
  try {
    const output=capture(),handlers=new Map()
    apply({logger:output.logger,on(name,fn){handlers.set(name,fn)},inject(){},get(){}})
    const emit=handlers.get('session/event'),value={id:'SECRET_OBSERVED_SESSION',firstLiveSeq:10}
    emit(value,{type:'assistant/attempt',seq:10,data:{text:'SECRET_ATTEMPT'}})
    emit(value,{type:'assistant/message',seq:8,data:{message:{source:{provider:'SECRET_PROVIDER',model:'SECRET_MODEL'},
      content:[{type:'text',text:'SECRET_MESSAGE'}]},usage:{inputTokens:100,outputTokens:20,totalTokens:120}}})
    const usage=output.rows().find(row=>row.event==='request.usage')
    assert.equal(usage.known,false);assert.equal(usage.cached,null);assert.equal(usage.historical,true)
    assert.ok(output.rows().some(row=>row.event==='request.attempt'))
    assert.ok(!output.lines.join('').includes('SECRET'))
  } finally {
    if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
    if(oldLevel===undefined)delete process.env.DSH_CONTEXT_MANAGER_LOG_LEVEL;else process.env.DSH_CONTEXT_MANAGER_LOG_LEVEL=oldLevel
    await rm(root,{recursive:true,force:true})
  }
})
