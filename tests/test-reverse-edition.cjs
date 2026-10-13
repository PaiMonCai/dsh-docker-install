'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const cp=require('node:child_process')
const root=path.resolve(__dirname,'..')
const read=f=>fs.readFileSync(path.join(root,f),'utf8')

test('Reverse Edition uses another Compose project, port, home and workspace',()=>{
 const normal=read('docker-compose.yml'),reverse=read('docker-compose.reverse.yml')
 assert.match(reverse,/^name: dsh-reverse$/m)
 assert.match(reverse,/container_name: dsh-reverse/)
 assert.match(reverse,/127\.0\.0\.1:\$\{DSH_REVERSE_PORT:-3081\}:3080/)
 assert.match(reverse,/dsh-reverse-home:\/root\/\.dsh/)
 assert.match(reverse,/DSH_REVERSE_WORKSPACE/)
 assert.doesNotMatch(reverse,/dsh-home:\/root\/\.dsh/)
 assert.doesNotMatch(reverse,/docker\.sock|privileged: true/)
 assert.match(normal,/container_name: dsh/)
 assert.match(normal,/dsh-home:\/root\/\.dsh/)
 assert.doesNotMatch(normal,/DSH_REVERSE_PURGE_PATCH|dsh-reverse-home/)
})

test('Standard runtime never activates the full patch without reverse edition variable',()=>{
 const e=read('docker/entrypoint.sh')
 assert.match(e,/if \[\[ -n "\$\{DSH_REVERSE_PURGE_PATCH:-\}" \]\]; then/)
 assert.match(e,/append_native_web_patch "\$\{DSH_REVERSE_PURGE_PATCH\}"/)
 assert.match(read('reverse/Dockerfile'),/ENV DSH_REVERSE_PURGE_PATCH=\/opt\/dsh-reverse\/cordis\.patch\.yml/)
 assert.match(read('reverse/Dockerfile'),/DSH_REVERSE_AGENT_ENABLED=false/)
})

test('Full purge patch is preserved in generated overlay, without replacing its policies',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-reverse-edition-'))
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
 const write=(file,body)=>{
  const full=path.join(tmp,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body)
 }
 const original=[
  '- id: system-prompt',
  '  config:',
  '    includeHarnessIdentity: false',
  '- insert:',
  '    - id: dsh-purge',
  "      name: 'dsh-purge'",
  '      config:',
  '        enabled: true',
  '        hooksDenyBypass: true',
  '    - id: dsh-purge-redteam',
  '      name: dsh-purge/redteam',
  '    - id: dsh-purge-reverse',
  '      name: dsh-purge/reverse',
  '    - id: dsh-purge-reverse-ui',
  '      name: dsh-purge/reverse/ui',
  '    - id: dsh-purge-redteam-store',
  '      name: dsh-purge/redteam/store',
  '    - id: dsh-purge-redteam-ui',
  '      name: dsh-purge/redteam/ui',
 ].join('\n')+'\n'
 write('purge/cordis.patch.yml',original)
 write('purge/presets/reverse-engineering/agent.cordis.yml',
  'name: dsh-purge/reverse/tools\n')
 write('purge/presets/redteam/agent.cordis.yml',
  'name: dsh-purge/redteam/tools\n')
 write('purge/client.js','window.__ModuleLoader__.load({ id: "dsh-purge", factory: (require) => ({}) });\n')
 write('purge-ui/index.js','export function apply(){}\n')
 cp.execFileSync(process.execPath,[path.join(root,'reverse/generate-overlay.mjs')],
  {env:{...process.env,DSH_REVERSE_ROOT:tmp}})
 const made=fs.readFileSync(path.join(tmp,'cordis.patch.yml'),'utf8')
 assert.match(made,/hooksDenyBypass: true/)
 assert.match(made,/includeHarnessIdentity: false/)
 assert.match(made,/name: \.\/purge\/lib\/index\.js/)
 for(const mod of ['redteam/index','redteam/store','redteam/ui','reverse/index','reverse/ui'])
   assert.ok(made.includes('name: ./purge/lib/'+mod+'.js'),mod)
 assert.match(made,/dsh-reverse-purge-ui/)
 assert.match(made,/dsh-reverse-skill-bootstrap/)
 assert.equal(fs.readFileSync(path.join(tmp,'purge/cordis.patch.yml'),'utf8'),original)
 assert.match(fs.readFileSync(path.join(tmp,'purge/presets/reverse-engineering/agent.cordis.yml'),'utf8'),
   /name: \.\.\/\.\.\/lib\/reverse\/tools\.js/)
 assert.match(fs.readFileSync(path.join(tmp,'purge/presets/redteam/agent.cordis.yml'),'utf8'),
   /name: \.\.\/\.\.\/lib\/redteam\/tools\.js/)
 const browser=fs.readFileSync(path.join(tmp,'purge-ui/client.js'),'utf8')
 assert.match(browser,/window\.__ModuleLoader__\.load\(\{ id: "dsh-reverse-purge-ui"/)
 cp.execFileSync(process.execPath,['--check',path.join(tmp,'purge-ui/client.js')])
})

test('Dedicated image pins published tools and does not redistribute proprietary decompilers',()=>{
 const f=read('reverse/Dockerfile')
 assert.match(f,/PURGE_COMMIT=28c8eaf5b5de70d53795387d01faae9498a83d63/)
 assert.match(f,/REA_VERSION=6\.4\.0/)
 assert.match(f,/GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db/)
 assert.match(f,/JADX_MCP_SHA256=6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75/)
 assert.match(f,/REA_JADX_MCP_JAR/)
 assert.match(f,/JADX_SHA256=8280f3799c0273fe797a2bcd90258c943e451fd195f13d05400de5e6451d15ec/)
 assert.match(f,/pwntools==4\.15\.0/)
 assert.match(f,/frida-tools==14\.11\.0/)
 assert.match(f,/gdb-multiarch/)
 assert.match(f,/apktool/)
 assert.doesNotMatch(f,/apt-get install[^\n]*ida-pro|hopper/)
})


test('Five reverse Skills are valid and bootstrapped without replacing edits',async t=>{
 const {pathToFileURL}=require('node:url')
 const module=await import(pathToFileURL(path.join(root,'reverse/skills-bootstrap.mjs')).href)
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-reverse-skilltest-'))
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 assert.equal(module.SKILLS.length,5)
 const dest=path.join(home,'reverse-engineering','skills')
 for(const id of module.SKILLS){
   const source=read('reverse/skills/'+id+'/SKILL.md')
   assert.ok(source.startsWith('---\nname: '+id+'\n'))
   assert.match(source,/^description:/m)
   assert.doesNotMatch(source,/^\s*(?:curl\b.*\|\s*(?:bash|sh)\b|npm\s+install\b|pip\s+install\b)/m)
 }
 const existing=path.join(dest,'binary-triage')
 fs.mkdirSync(existing,{recursive:true})
 fs.writeFileSync(path.join(existing,'SKILL.md'),'user-custom-skill')
 module.installSkills(home,path.join(root,'reverse/skills'))
 assert.equal(fs.readFileSync(path.join(existing,'SKILL.md'),'utf8'),'user-custom-skill')
 for(const id of module.SKILLS){
   assert.ok(fs.existsSync(path.join(dest,id,'SKILL.md')))
 }
 module.installSkills(home,path.join(root,'reverse/skills'))
 assert.equal(fs.readFileSync(path.join(existing,'SKILL.md'),'utf8'),'user-custom-skill')
})
