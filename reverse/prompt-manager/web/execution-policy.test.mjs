import test from 'node:test'
import assert from 'node:assert/strict'
import { webExecutionPolicy,assertWebQueueExecution,CONFIRMATION,QUEUE_KINDS } from './execution-policy.mjs'
test('Web queue policy denies execution by default',()=>{
 const p=webExecutionPolicy({})
 assert.equal(p.web_execution_enabled,false)
 assert.equal(p.scope,'web-queue-only')
 assert.equal(p.agent_direct_tools,'outside-this-policy')
 assert.throws(()=>assertWebQueueExecution(CONFIRMATION,'triage',{}),/disabled/)
})
test('Web execution requires exact opt-in, human confirmation and fixed tool kind',()=>{
 const enabled={DSH_REVERSE_WEB_EXECUTION:'1'}
 assert.throws(()=>assertWebQueueExecution('', 'triage',enabled),/confirmation/)
 assert.throws(()=>assertWebQueueExecution(CONFIRMATION,'shell',enabled),/unsupported/)
 assert.equal(assertWebQueueExecution(CONFIRMATION,'triage',enabled),true)
 assert.equal(assertWebQueueExecution(CONFIRMATION,'diff',enabled),true)
 assert.equal(QUEUE_KINDS.length,5)
 assert.equal(webExecutionPolicy({DSH_REVERSE_WEB_EXECUTION:'TRUE'}).web_execution_enabled,false)
})
test('status omits confirmation token and sensitive env values',()=>{
 const report=webExecutionPolicy({DSH_REVERSE_WEB_EXECUTION:'1',PRIVATE_TOKEN:'secret'})
 assert.equal(report.web_execution_enabled,true)
 assert.ok(!JSON.stringify(report).includes(CONFIRMATION))
 assert.ok(!JSON.stringify(report).includes('secret'))
})
