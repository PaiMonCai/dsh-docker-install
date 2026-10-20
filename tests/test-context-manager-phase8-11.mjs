import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const {replacePresetCompactor,createTakeoverPolicy,ACP_TOOLS}=await import('../docker/plugins/dsh-context-manager/takeover.mjs')
const {defaults}=await import('../docker/plugins/dsh-context-manager/policy.mjs')
test('ACP requires explicit single-owner test gate and defaults off',()=>{
 assert.equal(createTakeoverPolicy({},defaults()).active,false)
 assert.throws(()=>createTakeoverPolicy({DSH_CONTEXT_MANAGER_ACP_ACTIVE:'1'},defaults()),/requires/)
 const settings=defaults();settings.engine='tiered'
 const policy=createTakeoverPolicy({DSH_CONTEXT_MANAGER_TIERED_ACTIVE:'1',DSH_CONTEXT_MANAGER_ACP_ACTIVE:'1',
 DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED:'1',DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY:'1'},settings)
 assert.equal(policy.acp,true)
})
test('single Standard preset retains native engine and adds exactly one ACP tool package',()=>{
 const settings=defaults();settings.engine='tiered'
 const preset={id:'standard',plugins:[{id:'compaction',name:'cordis:group',group:true,
 config:[{id:'compaction-basic',name:'@deepseek-ai/dsh-compaction-basic'},
 {id:'command-compact',name:'@deepseek-ai/dsh-command-compact'}]}]}
 const result=replacePresetCompactor(preset,settings,'standard',{acp:true})
 assert.equal(result.changed,true)
 const rows=result.config.plugins[0].config
 assert.equal(rows.filter(r=>r.name===ACP_TOOLS).length,1)
 assert.equal(rows.find(r=>r.id==='compaction-basic').config.auto,true)
 assert.equal(rows.filter(r=>r.name==='@deepseek-ai/dsh-command-compact').length,1)
 assert.equal(replacePresetCompactor({...preset,id:'reverse-engineering'},settings,'standard',{acp:true}).changed,false)
})
test('image build and all four model-facing native ACP tools are wired',()=>{
 const docker=read('Dockerfile')
 assert.match(read('docker/plugins/dsh-context-manager/package.json'),/"acp-kernel": "0.0.101"/)
 assert.match(docker,/test-context-manager-acp-native.mjs/)
 assert.match(docker,/npm install --prefix \/opt\/dsh\/plugins\/dsh-context-manager/)
 const src=read('docker/plugins/dsh-context-manager/acp-native.js')
 for(const name of ['acp_status','acp_compress','acp_decompress','acp_search_context'])
 assert.ok(src.includes("'"+name+"'"))
 assert.match(src,/agent\/pre-step/)
 assert.match(read('docker/plugins/dsh-context-manager/acp-runtime.mjs'),/appendRecord\(session,STATE_EVENT/)
})
