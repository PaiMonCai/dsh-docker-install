import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('native transaction suite is executed inside the packaged DSH build',()=>{
 const docker=read('Dockerfile')
 assert.match(docker,/test-context-manager-native-transaction.mjs/)
 const smoke=read('tests/test-context-manager-native-transaction.mjs')
 assert.match(smoke,/engine.compactNow/)
 assert.match(smoke,/indexCompactions/)
 assert.match(smoke,/originalPage/)
 assert.match(smoke,/ControlledAdapter extends LlmAdapter/)
 assert.match(smoke,/NATIVE_TIERED_SUCCESS/)
 assert.match(smoke,/NATIVE_TIERED_FAIL_CLOSED/)
})
test('live takeover remains disabled in production default and only a single Standard preset is targeted',()=>{
 const code=read('docker/plugins/dsh-context-manager/takeover.mjs')
 const launcher=read('docker/entrypoint.sh')
 assert.match(code,/DSH_CONTEXT_MANAGER_TIERED_ACTIVE==='1'/)
 assert.match(launcher,/DSH_CONTEXT_MANAGER_TIERED_ACTIVE:-0/)
 assert.match(code,/const ALLOWED_PRESET='standard'/)
 assert.doesNotMatch(read('docker/plugins/dsh-context-manager/cordis.patch.yml'),/tiered-native/)
 assert.doesNotMatch(launcher,/DSH_CONTEXT_MANAGER_TIERED_ACTIVE:-1/)
})
test('multi-model real API calls and network credentials are never bundled in CI smoke',()=>{
 const code=read('tests/test-context-manager-native-transaction.mjs')
 assert.doesNotMatch(code,/process.env.OPENAI_API_KEY|process.env.ANTHROPIC_API_KEY|fetch\(/)
 assert.match(code,/synthetic model transport failure/)
 assert.match(code,/adapter\.mode=mode/)
})
