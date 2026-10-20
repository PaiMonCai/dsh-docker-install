import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { auditOwnership } from '../docker/plugins/dsh-context-manager/ownership-audit.mjs'
import { installReplaySmoke } from '../docker/plugins/dsh-context-manager/ci-replay.mjs'
import { apply,ENDPOINT } from '../docker/plugins/dsh-context-manager/index.js'
const file = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('ownership gate never mistakes one active Agent plugin for proven unique compaction ownership',()=>{
  const row={id:'standard',mounted:true,ownership:'preset-native-active',
    basic:{active:1},external:{active:0}}
  const audit=auditOwnership({available:true,presets:[row]},{available:false})
  assert.equal(audit.safeToActivateTiered,false)
  assert.equal(audit.ownerVerified,false)
  assert.equal(audit.status,'unverified')
  assert.equal(audit.presets[0].state,'preset-native-observed')
  assert.ok(audit.blockers.includes('external-gateway-interception-not-observable'))
})
test('mixed builtin and external plugins force conflict risk, host visibility is not certification',()=>{
  const inventory={available:true,presets:[{id:'reverse-engineering',mounted:true,
    ownership:'conflict-risk',basic:{active:1},external:{active:1}}]}
  const audit=auditOwnership(inventory,{available:true})
  assert.equal(audit.status,'conflict-risk')
  assert.equal(audit.hostVisible,true)
  assert.equal(audit.ownerVerified,false)
  assert.equal(audit.presets[0].state,'conflict-risk')
})
test('missing or empty inventory is explicitly unverified',()=>{
  assert.deepEqual(auditOwnership(null,null).presets,[])
  assert.equal(auditOwnership({available:false,presets:[]},null).status,'unverified')
})
test('replay smoke is inert outside explicitly isolated CI volume',()=>{
  const before=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
  delete process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
  try{
    installReplaySmoke({inject(){throw Error('unexpected side effect')}})
  }finally{if(before===undefined)delete process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
    else process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=before}
})
test('replay smoke requires explicit CI test-volume admission',()=>{
  const mode=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
  const confirm=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM
  process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE='seed'
  delete process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM
  try {assert.throws(()=>installReplaySmoke({}),/isolated test-volume/)}
  finally{
    if(mode===undefined)delete process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
    else process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE=mode
    if(confirm===undefined)delete process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM
    else process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=confirm
  }
})
test('runtime RPC only reports risk, never enables the candidate backend',async()=>{
  const handlers={}
  const ctx={get:()=>undefined,on(){},logger:{warn(){}},
    inject(_,callback){callback({connection:{rpc:{handle(path,fn){handlers[path]=fn}}}})}}
  apply(ctx)
  const result=await handlers[ENDPOINT]('status',{})
  assert.equal(result.ok,true)
  assert.equal(result.value.ownerAudit.safeToActivateTiered,false)
  assert.equal(result.value.ownerAudit.ownerVerified,false)
  assert.equal(result.value.engine,'not-installed')
})
test('CI script creates two different containers with one persistent volume',()=>{
  const sh=file('tests/test-context-manager-native-replay.sh')
  assert.match(sh,/docker rm -f "\$name"/)
  assert.match(sh,/start seed/)
  assert.match(sh,/start verify "\$sid"/)
  assert.match(sh,/volume="\$\{unique\}-data"/)
  assert.match(sh,/cold=true/)
  assert.match(file('.github/workflows/build.yml'),/test-context-manager-native-replay.sh dsh-ci:pr standard/)
  assert.match(file('.github/workflows/build-reverse.yml'),/test-context-manager-native-replay.sh "\$IMAGE" reverse-engineering/)
  assert.match(file('Dockerfile'),/ci-replay.mjs/)
})
