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
 write('purge/presets/reverse-engineering/preset.yml','name: 逆向工程\ndescription: Reverse analysis\norder: 20\n')
 write('purge/presets/reverse-engineering/agent.cordis.yml',
  'name: dsh-purge/reverse/tools\n')
 write('purge/presets/redteam/agent.cordis.yml',
  'name: dsh-purge/redteam/tools\n')
 write('purge/client.js','window.__ModuleLoader__.load({ id: "dsh-purge", factory: (require) => ({}) });\n')
 write('purge-ui/index.js','export function apply(){}\n')
 const hostModules=[
   ['core','lib/index'], ['redteam','lib/redteam/index'],
   ['redteam-store','lib/redteam/store'], ['redteam-ui','lib/redteam/ui'],
   ['reverse','lib/reverse/index'], ['reverse-ui','lib/reverse/ui'],
 ]
 for(const [,source] of hostModules){
   write('purge/'+source+'.js',"export const name='stub'; export const inject=[]; export function apply(){}\n")
 }
 cp.execFileSync(process.execPath,[path.join(root,'reverse/generate-overlay.mjs')],
  {env:{...process.env,DSH_REVERSE_ROOT:tmp}})
 const made=fs.readFileSync(path.join(tmp,'cordis.patch.yml'),'utf8')
 assert.match(made,/hooksDenyBypass: true/)
 assert.match(made,/includeHarnessIdentity: false/)
 assert.match(made,/name: \.\/host-modules\/core\/index\.js/)
 for(const [id] of hostModules){
   assert.ok(made.includes('name: ./host-modules/'+id+'/index.js'),id)
   const pkg=JSON.parse(fs.readFileSync(path.join(tmp,'host-modules',id,'package.json'),'utf8'))
   assert.equal(pkg.name,'dsh-reverse-'+id)
    if(id==='reverse'){
      const content=fs.readFileSync(path.join(tmp,'host-modules',id,'index.js'),'utf8')
      assert.match(content,/DSH_REVERSE_CI_VERIFY_PRESET/)
      assert.match(content,/agentPresets/)
      assert.match(content,/preset\.broken/)
    }
   cp.execFileSync(process.execPath,['--check',path.join(tmp,'host-modules',id,'index.js')])
 }
 assert.equal(new Set(hostModules.map(([id])=>id)).size,6)
 assert.match(made,/dsh-reverse-purge-ui/)
 assert.match(made,/dsh-reverse-skill-bootstrap/)
 assert.match(made,/dsh-reverse-preset-declaration/)
 assert.match(made,/@deepseek-ai\/dsh-agent-preset/)
 assert.match(made,/id: reverse-engineering/)
 assert.match(made,/name: file:\/\/\/opt\/dsh-reverse\/purge\/lib\/reverse\/tools\.js/)
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


test('Nine advanced reverse Skills exclude Android and preserve user edits',async t=>{
 const {pathToFileURL}=require('node:url')
 const module=await import(pathToFileURL(path.join(root,'reverse/skills-bootstrap.mjs')).href)
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-reverse-skilltest-'))
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
 assert.equal(module.SKILLS.length,9)
 assert.equal(new Set(module.SKILLS).size,9)
 assert.ok(!module.SKILLS.includes('android-apk-analysis'))
 assert.equal(fs.existsSync(path.join(root,'reverse/skills/android-apk-analysis')),false)
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
 // Retire a previously installed official Android Skill, but never user edits.
 const retired=path.join(dest,'android-apk-analysis')
 fs.mkdirSync(retired,{recursive:true})
 fs.writeFileSync(path.join(retired,'SKILL.md'),"---\nname: android-apk-analysis\ndescription: Inspect authorized Android APK/DEX statically using JADX, apktool and discovered REA MCP tools, mapping manifest and Java/smali classes.\n---\n# Android APK / DEX Static Analysis\n1. Confirm authorized artifact. Record APK hash and preserve original bytes.\n2. Choose unique private output directories in /workspace/reverse-analysis. Read jadx --help and apktool --help before using flags.\n3. Typical read-only inputs: jadx -d /workspace/reverse-analysis/jadx-output /workspace/sample.apk; apktool d -o /workspace/reverse-analysis/resources /workspace/sample.apk.\n4. Review decoded AndroidManifest, exported activities/services/receivers, permissions, intent filters, DEX class entrypoints and relevant resources.\n5. Trace only classes/methods related to the user question. Compare JADX's Java-like reconstruction with smali when compiler transformations or obfuscation cause ambiguity.\n6. If REA exposes Android tools, first verify the real MCP tool list and invoke relevant read-only tools. REA installed does not guarantee device providers.\n7. Record hashes, component names, class/method identifiers and observations separately from hypotheses; do not disclose embedded credentials in reports.\nDo not install or run the APK, attach Frida or connect a device without authorization and an isolated environment.\n")
 module.installSkills(home,path.join(root,'reverse/skills'))
 assert.equal(fs.existsSync(retired),false)
 assert.equal(fs.readFileSync(path.join(existing,'SKILL.md'),'utf8'),'user-custom-skill')
 fs.mkdirSync(retired,{recursive:true})
 fs.writeFileSync(path.join(retired,'SKILL.md'),'user-custom-android-skill')
 module.installSkills(home,path.join(root,'reverse/skills'))
 assert.equal(fs.readFileSync(path.join(retired,'SKILL.md'),'utf8'),'user-custom-android-skill')
 for(const id of module.SKILLS){
   assert.ok(fs.existsSync(path.join(dest,id,'SKILL.md')))
 }
 module.installSkills(home,path.join(root,'reverse/skills'))
 assert.equal(fs.readFileSync(path.join(existing,'SKILL.md'),'utf8'),'user-custom-skill')
})
