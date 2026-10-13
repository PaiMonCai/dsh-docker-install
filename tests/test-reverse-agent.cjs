'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {pathToFileURL}=require('node:url')

function fixture(t, input = {}) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-reverse-native-'))
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}))
  const source=fs.readFileSync(path.join(__dirname,'../docker/plugins/dsh-reverse-agent/index.js'),'utf8')
  const write=(name,data)=>{
    const file=path.join(temp,name)
    fs.mkdirSync(path.dirname(file),{recursive:true})
    fs.writeFileSync(file,data)
  }
  write('package.json',JSON.stringify({type:'module'}))
  write('index.js',source)
  write('vendor/lib/reverse/index.js', [
    "export const PRESET_ID='reverse-engineering'",
    'export function prepareReverseAssets() { return {skillPath:"/tmp/test"} }',
  ].join('\n'))
  write('vendor/lib/redteam/preset-composition.js',[
    "export function readPresetDefinition(id,base) {",
    "  return {id,name:'逆向工程',plugins:[",
    "    {id:'rea-mcp',name:'@deepseek-ai/dsh-mcp-client',config:{command:'rea',args:['mcp']}},",
    "    {id:'reverse-workflow-tools',name:'dsh-purge/reverse/tools'}",
    '  ]}',
    '}',
  ].join('\n'))
  write('vendor/presets/reverse-engineering/preset.yml','name: 逆向工程')
  write('vendor/lib/reverse/tools.js','export const name="stub"')
  return pathToFileURL(path.join(temp,'index.js')).href
}

const waitFor=async predicate=>{
  for(let i=0;i<60;i++) {
    if(predicate()) return
    await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.fail('timed out waiting for reverse preset register')
}

test('Docker-native preset rewrites ONLY its scoped tool into a file URL',async t=>{
  const entry=await import(fixture(t))
  const d=entry.reverseDefinition()
  assert.equal(d.id,'reverse-engineering')
  assert.equal(d.plugins[0].config.command,'rea')
  assert.equal(d.plugins[1].name.startsWith('file:'),true)
  assert.equal(d.plugins[1].name.endsWith('/vendor/lib/reverse/tools.js'),true)
})

test('registers reverse preset on the host and disposes on unload',async t=>{
  const entry=await import(fixture(t))
  let onCleanup,registered,disposed=false
  const registry={
    async list(){return registered?[{id:'reverse-engineering'}]:[]},
    async register(d){registered=d;return async()=>{disposed=true}},
  }
  entry.apply({
    effect(fn){onCleanup=fn()},
    get(name){return name==='agentPresets'?registry:null},
    logger:{info(){},warn(m){throw Error(String(m))}},
  })
  await waitFor(()=>registered)
  assert.equal(registered.id,'reverse-engineering')
  assert.equal(registered.plugins.find(p=>p.id==='rea-mcp').name,'@deepseek-ai/dsh-mcp-client')
  onCleanup()
  await waitFor(()=>disposed)
})

test('preserves existing preset rather than overwriting user-installed dsh-purge',async t=>{
  const entry=await import(fixture(t))
  let registered=false,cleanup
  entry.apply({
    effect(fn){cleanup=fn()},
    get(){return {async list(){return [{id:'reverse-engineering'}]},async register(){registered=true}}},
    logger:{info(){},warn(m){throw Error(String(m))}},
  })
  await new Promise(r=>setTimeout(r,35))
  assert.equal(registered,false)
  cleanup()
})

test('image files and flags use native overlays; no global dsh-purge agent hooks',()=>{
  const root=path.join(__dirname,'..')
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8')
  const entry=fs.readFileSync(path.join(root,'docker/entrypoint.sh'),'utf8')
  const compose=fs.readFileSync(path.join(root,'docker-compose.yml'),'utf8')
  const patch=fs.readFileSync(path.join(root,'docker/plugins/dsh-reverse-agent/cordis.patch.yml'),'utf8')
  assert.match(docker,/rea-agents@\$\{REA_VERSION\}/)
  assert.match(docker,/ARG REA_VERSION=6\.4\.0/)
  assert.match(docker,/REVERSE_AGENT_COMMIT=28c8eaf5b5de70d53795387d01faae9498a83d63/)
  assert.match(docker,/COPY --from=reverse-agent-source/)
  assert.match(entry,/append_native_web_patch ".*dsh-reverse-agent\/cordis\.patch\.yml" "\$\{DSH_REVERSE_AGENT_ENABLED:-true\}"/)
  assert.match(compose,/DSH_REVERSE_AGENT_ENABLED/)
  assert.match(patch,/name: \.\/index\.js/)
  assert.doesNotMatch(patch,/dsh-purge\/redteam|dsh-purge\/reverse\/ui/)
  assert.doesNotMatch(entry,/dsh plugin (add|install).*reverse/)
})
