import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasQueuedAcpSummary,queueAcpSummary,clearQueuedAcpSummary,withAcpSummary,currentAcpSummary,
} from '../docker/plugins/dsh-context-manager/acp-pending.mjs'
import {makeNativeTieredEngine} from '../docker/plugins/dsh-context-manager/tiered-backend.mjs'

test('per-Session model proposal excludes only native pressure auto-pass',async()=>{
 const calls=[]
 class Basic {
  constructor(ctx,config){this.config=config}
  async compactIfNeeded(agent,trigger){calls.push(trigger);return {trigger}}
  async summarize(){throw Error('unused')}
 }
 const prior=process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
 process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED='1'
 try {
  const Engine=makeNativeTieredEngine(Basic,{BlockAssembler:class {}})
  const engine=new Engine({}, {auto:true})
  const session={},other={}
  assert.deepEqual(await engine.compactIfNeeded({session},'pressure'),{trigger:'pressure'})
  const proposal={summary:'real model summary'}
  queueAcpSummary(session,proposal)
  assert.equal(hasQueuedAcpSummary(session),true)
  assert.equal(await engine.compactIfNeeded({session},'pressure'),null)
  assert.deepEqual(await engine.compactIfNeeded({session},'context-overflow'),{trigger:'context-overflow'})
  assert.deepEqual(await engine.compactIfNeeded({session:other},'pressure'),{trigger:'pressure'})
  assert.deepEqual(calls,['pressure','context-overflow','pressure'])
  assert.throws(()=>queueAcpSummary(session,{}),/already queued/)
  clearQueuedAcpSummary(session,{})
  assert.equal(hasQueuedAcpSummary(session),true)
  await withAcpSummary(session,proposal,async()=>{
   assert.equal(currentAcpSummary(session),proposal)
  })
  assert.equal(currentAcpSummary(session),null)
  clearQueuedAcpSummary(session,proposal)
  assert.equal(hasQueuedAcpSummary(session),false)
  assert.deepEqual(await engine.compactIfNeeded({session},'pressure'),{trigger:'pressure'})
 }finally{
  if(prior===undefined)delete process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED
  else process.env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=prior
 }
})
