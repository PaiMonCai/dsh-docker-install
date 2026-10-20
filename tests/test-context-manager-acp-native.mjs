/**
 * Run inside the DSH image after acp-kernel is installed; no API credentials.
 * Verify the actual published kernel is called and the DSH log is authoritative.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {AcpRuntime,STATE_EVENT} from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
const rq=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const dsh=await import(pathToFileURL(rq.resolve('@deepseek-ai/dsh-session')).href)
const {Session,SessionId,appendPluginRecord}=dsh
const session=Session.create(SessionId('acp-native-disposable'))
const original='A verified original statement must remain recoverable after compaction. '.repeat(48)
for(let i=0;i<8;i++){
  session.append('user/message',{id:'acp-user-'+i,role:'user',source:{kind:'user'},
    content:[{type:'text',text:original+' evidence '+i}]},{surfaceOp:'append'})
}
const kernel=new AcpRuntime({appendRecord:appendPluginRecord,logger:{warn:()=>{}}})
const before=kernel.status(session)
assert.equal(before.kernel,'acp-kernel')
assert.equal(before.refs.length,8)
const proposal=kernel.propose(session,{startRef:before.refs[0].ref,
  endRef:before.refs[3].ref,summary:'User goals are to preserve all verified evidence while keeping a native DSH history and one compression owner. All facts remain grounded. '.repeat(2)})
assert.equal(proposal.accepted,true)
let commits=0
const fakeNativeCompaction={
 async compactRegion(start,end){
  commits++
  const ids=session.surface.nodes.slice(session.surface.nodes.indexOf(start),
    session.surface.nodes.indexOf(end)+1)
  const compactionId='test-native-acp-'+commits
  const begin=session.append('compaction/start',{compactionId,turn:null})
  const sum=session.append('compaction/summary',{
    compactionId,summary:[{type:'text',text:'mock native summary'}],
    shadowedRange:{start,end},shadowedSeqs:ids,shadowedTokenCount:600,
    provider:'offline-test',model:'controlled',
  })
  session.append('user/message',{
    id:'acp-checkpoint-'+commits,role:'user',
    source:{kind:'compact-checkpoint',compactionId},
    content:[{type:'text',text:'<compacted-summary>\nmock native summary\n</compacted-summary>'}],
  },{surfaceOp:{op:'replace',startSeq:start,endSeq:end},
    sourceEventSeqs:[begin.seq,sum.seq,...ids]})
  session.append('compaction/end',{compactionId,turn:null})
  return {compactionId,summarySeq:sum.seq}
 }
}
const result=await kernel.processPending({session},fakeNativeCompaction,new AbortController().signal)
assert.equal(commits,1)
assert.equal(result.block,proposal.block)
assert.equal(session.snapshotEvents().filter(e=>e.type===STATE_EVENT).length,1)
const status=kernel.status(session)
assert.ok(status.blocks.some(b=>b.id===proposal.block))
const originals=kernel.decompress(session,proposal.block)
assert.match(originals.original,/verified original statement/)
assert.ok(originals.originalCount>=4)
const restored=Session.create(session.id,session.snapshotEvents(),session.header)
const recovered=new AcpRuntime({appendRecord:appendPluginRecord})
assert.ok(recovered.status(restored).blocks.some(b=>b.id===proposal.block))
assert.match(recovered.decompress(restored,proposal.block).original,/verified original statement/)
assert.equal(kernel.search(session,'verified').length>0,true)
process.stdout.write('DSH_CONTEXT_MANAGER_ACP_NATIVE_BRIDGE_PASS native=true restored=true\n')
