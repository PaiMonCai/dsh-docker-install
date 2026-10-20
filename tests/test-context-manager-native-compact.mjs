import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const requireDsh=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const { apply }=await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-command-compact')).href)
let registered, calls=0
const service={
 async compactNow(agent, signal, commandId){
  calls++
  assert.equal(agent?.id,'disposable-native-compact-agent')
  assert.equal(signal.aborted,false)
  assert.equal(commandId,'native-compact-test')
  return {shadowedSeqs:[1,2,3],shadowedTokenCount:321,summarySeq:8}
 }
}
const ctx={
 compaction:service,
 commands:{register(row){registered=row;return ()=>{}}},
 effect(generator){
  const it=generator()
  for(let step=it.next();!step.done;step=it.next()) {}
 }
}
apply(ctx)
assert.equal(registered.name,'compact')
const agent={id:'disposable-native-compact-agent'}
const signal=new AbortController().signal
const invocation={agent,signal,commandId:'native-compact-test',rawInput:''}
const r=await registered.handler(invocation)
assert.equal(r.kind,'success')
assert.equal(r.sourceEventSeq,8)
assert.match(r.text,/3 history items/)
assert.equal(calls,1)
const bad=await registered.handler({...invocation,rawInput:'extra'})
assert.equal(bad.kind,'error')
assert.equal(calls,1)
process.stdout.write('DSH_CONTEXT_MANAGER_NATIVE_COMPACT_BINDING_PASS upstream-command-handler=true calls=1\n')
