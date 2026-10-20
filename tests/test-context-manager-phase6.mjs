import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {replacePresetCompactor,createTakeoverPolicy,TIERED,BASIC,GATE} from '../docker/plugins/dsh-context-manager/takeover.mjs'
import {defaults} from '../docker/plugins/dsh-context-manager/policy.mjs'
const native=()=>({
 id:'standard',plugins:[{id:'a',group:true,config:[
 {id:'compaction-basic',name:BASIC,config:{auto:true}},
 {id:'command-compact',name:'@deepseek-ai/dsh-command-compact'},
 {id:'pruner',name:'@deepseek-ai/dsh-compaction-tool-result-pruner'},
 ]}]})
function selected(){const s=defaults();s.engine='tiered';return s}
test('single owner replaces exact basic backend and retains manual /compact and other rows',()=>{
 const src=native(),before=structuredClone(src)
 const r=replacePresetCompactor(src,selected())
 assert.equal(r.changed,true)
 assert.equal(r.evidence.replaced,1)
 const rows=r.config.plugins[0].config
 assert.equal(rows.length,3)
 assert.equal(rows[0].id,'compaction-basic')
 assert.equal(rows[0].name,TIERED)
 assert.equal(rows[0].config.thresholdRatio,.75)
 assert.equal(rows[1].name,'@deepseek-ai/dsh-command-compact')
 assert.deepEqual(src,before)
})
test('model-specific native threshold overrides are applied without a second service',()=>{
 const s=selected()
 s.modelPolicies=[{provider:'provider1',model:'model1',basic:{thresholdRatio:.65,retainRatio:.1}}]
 const result=replacePresetCompactor(native(),s)
 const config=result.config.plugins[0].config[0].config
 assert.deepEqual(config.modelPolicies,[{provider:'provider1',model:'model1',thresholdRatio:.65,retainRatio:.1}])
 assert.equal(config.thresholdRatio,.75)
})
test('refuses duplicate Basic, competing external bili, absent /compact, preexisting tiered',()=>{
 const both=native(); both.plugins[0].config.push({id:'other',name:BASIC})
 assert.throws(()=>replacePresetCompactor(both,selected()),/precondition/)
 const external=native(); external.plugins[0].config.push({name:'bili-native'})
 assert.throws(()=>replacePresetCompactor(external,selected()),/precondition/)
 const noManual=native(); noManual.plugins[0].config.splice(1,1)
 assert.throws(()=>replacePresetCompactor(noManual,selected()),/precondition/)
 const preexisting=native();preexisting.plugins[0].config[0].name=TIERED
 assert.throws(()=>replacePresetCompactor(preexisting,selected()),/precondition/)
})
test('does not force Reverse presets lacking a compactor or silently alter other engines',()=>{
 const reverse=native();reverse.id='reverse-engineering'
 assert.equal(replacePresetCompactor(reverse,selected()).changed,false)
 assert.throws(()=>replacePresetCompactor(native(),defaults()),/not tiered/)
 const model=selected();model.modelPolicies=[{provider:'test',model:'m',engine:'off'}]
 assert.throws(()=>replacePresetCompactor(native(),model),/unsupported/)
})
test('lab activation requires two attestations; ordinary installs remain inert',()=>{
 assert.deepEqual(createTakeoverPolicy({},defaults()),{active:false,reason:'disabled'})
 assert.throws(()=>createTakeoverPolicy({DSH_CONTEXT_MANAGER_TIERED_ACTIVE:'1'},selected()),/attestations/)
 assert.throws(()=>createTakeoverPolicy({DSH_CONTEXT_MANAGER_TIERED_ACTIVE:'1',
 DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED:'1',DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY:'1'},defaults()),/saved tiered/)
 const r=createTakeoverPolicy({DSH_CONTEXT_MANAGER_TIERED_ACTIVE:'1',
 DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED:'1',DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY:'1'},selected())
 assert.equal(r.target,'standard');assert.equal(r.active,true)
})
test('pilot does not register an extra compaction service or turn off manual command',()=>{
 const s=readFileSync(new URL('../docker/plugins/dsh-context-manager/takeover.mjs',import.meta.url),'utf8')
 assert.equal(s.includes('ctx.compaction ='),false)
 const patch=readFileSync(new URL('../docker/plugins/dsh-context-manager/cordis.tiered-lab.patch.yml',import.meta.url),'utf8')
 assert.match(patch,/preset-standard/)
 assert.match(patch,/dshContextTieredPolicy/)
 assert.equal(patch.includes('biliBasicCompactionPolicy'),false)
})
