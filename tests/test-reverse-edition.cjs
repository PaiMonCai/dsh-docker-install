'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

test('Reverse deployment is isolated from Standard', () => {
 const normal=read('docker-compose.yml'), reverse=read('docker-compose.reverse.yml')
 assert.match(reverse,/^name: dsh-reverse$/m)
 assert.match(reverse,/container_name: dsh-reverse/)
 assert.match(reverse,/127\.0\.0\.1:\$\{DSH_REVERSE_PORT:-3081\}:3080/)
 assert.match(reverse,/dsh-reverse-home:\/root\/\.dsh/)
 assert.match(reverse,/DSH_REVERSE_WORKSPACE/)
 assert.doesNotMatch(reverse,/dsh-home:\/root\/\.dsh|docker\.sock|privileged: true/)
 assert.match(normal,/container_name: dsh/)
 assert.doesNotMatch(normal,/DSH_REVERSE_AGENT_PATCH/)
})
test('Image uses its own native Reverse Agent preset and REA', () => {
 const f=read('reverse/Dockerfile'),e=read('docker/entrypoint.sh')
 const compose=read('docker-compose.reverse.yml'),overlay=read('reverse/cordis.patch.yml')
 assert.match(f,/ENV DSH_REVERSE_AGENT_PATCH=\/opt\/dsh-reverse\/cordis\.patch\.yml/)
 assert.match(e,/DSH_REVERSE_AGENT_PATCH/)
 assert.match(compose,/DSH_REVERSE_AGENT_PATCH/)
 assert.match(f,/COPY reverse\/cordis\.patch\.yml/)
 assert.match(overlay,/id: dsh-reverse-preset-declaration/)
 assert.match(overlay,/name: '@deepseek-ai\/dsh-agent-preset'/)
 assert.match(overlay,/id: reverse-engineering/)
 assert.match(overlay,/id: rea-mcp/)
 assert.match(overlay,/command: rea/)
 assert.match(overlay,/dshHomePath\('reverse-engineering\/skills'\)/)
 assert.match(overlay,/sampleOverCapGlobResults: false/)
 assert.match(overlay,/allowParallelInProgress: true/)
 assert.match(overlay,/id: dsh-reverse-preset-smoke/)
 assert.match(overlay,/id: dsh-reverse-skill-bootstrap/)
 assert.doesNotMatch(overlay,/dsh-purge|redteam|reverse-workflow-tools|hooksDenyBypass/)
})
test('No third-party purge implementation is packaged or activated',()=>{
 for(const p of ['reverse/generate-overlay.mjs','reverse/purge-ui/index.js','reverse/purge-ui/package.json'])
  assert.equal(fs.existsSync(path.join(root,p)),false,p)
 const docker=read('reverse/Dockerfile'), entry=read('docker/entrypoint.sh'), compose=read('docker-compose.reverse.yml')
 for(const body of [docker,entry,compose])
   assert.doesNotMatch(body,/PURGE_COMMIT|DSH_REVERSE_PURGE_PATCH|DSH_PURGE_ENABLED|git -C \/tmp\/dsh-purge/)
 assert.doesNotMatch(docker,/COPY reverse\/purge-ui|generate-overlay|git init|git fetch/)
 assert.doesNotMatch(entry,/Reverse Edition dsh-purge/)
})
test('Reverse pins the published analysis engines',()=>{
 const f=read('reverse/Dockerfile')
 for(const token of ['REA_VERSION=6.4.0','GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db','JADX_MCP_SHA256=6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75','REA_JADX_MCP_JAR','JADX_SHA256=8280f3799c0273fe797a2bcd90258c943e451fd195f13d05400de5e6451d15ec','pwntools==4.15.0','frida-tools==14.11.0','gdb-multiarch','apktool'])assert.ok(f.includes(token),token)
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

test('Phase one ships native analysis and a real session readiness gate',()=>{
 const docker=read('reverse/Dockerfile')
 const overlay=read('reverse/cordis.patch.yml')
 const workflow=read('.github/workflows/build-reverse.yml')
 for(const p of ['reverse/bin/reverse-triage','reverse/bin/reverse-ghidra',
    'reverse/ghidra-scripts/ExportFunctions.py','reverse/service-health.mjs',
    'reverse/reverse-healthcheck.cjs','reverse/tests/test_triage.py'])
   assert.ok(fs.existsSync(path.join(root,p)),p)
 assert.match(docker,/HEALTHCHECK/)
 assert.ok(docker.includes('reverse-healthcheck.cjs'))
 assert.ok(docker.includes('lief==1.0.0'))
 assert.ok(docker.includes('flare-capa==9.4.0'))
 assert.match(overlay,/id: dsh-reverse-session-health/)
 assert.ok(read('reverse/preset-smoke.mjs').includes('sessionController.create'))
 assert.match(workflow,/DSH_REVERSE_CI_SESSION_CREATED/)
 assert.ok(workflow.includes('unittest discover -s reverse/tests'))
})

test('Reverse disables live config HMR to preserve sessionController lifetime',()=>{
 assert.match(read('reverse/cordis.patch.yml'),/- id: hmr\n  disabled: true/)
 assert.doesNotMatch(read('docker-compose.yml'),/DSH_REVERSE_AGENT_PATCH/)
})

test('Reverse native Prompt Manager is scoped, rollback-safe and image-owned',()=>{
 const docker=read('reverse/Dockerfile')
 const overlay=read('reverse/cordis.patch.yml')
 const workflow=read('.github/workflows/build-reverse.yml')
 for(const p of ['reverse/prompt-manager/core.mjs','reverse/prompt-manager/index.mjs',
  'reverse/prompt-manager/cli.mjs','reverse/prompt-manager/presets/evidence.json',
  'reverse/prompt-manager/test/prompt-manager.test.mjs']) assert.ok(fs.existsSync(path.join(root,p)),p)
 assert.match(docker,/COPY reverse\/prompt-manager\//)
 assert.match(docker,/reverse-prompt list/)
 assert.match(overlay,/id: dsh-reverse-prompt-manager/)
 assert.match(workflow,/node --test reverse\/prompt-manager\/test/)
 assert.ok(read('reverse/prompt-manager/index.mjs').includes("'reverse-engineering'"))
 assert.doesNotMatch(read('docker-compose.yml'),/DSH_REVERSE_PROMPT/)
})


test('Reverse Prompt Manager supports live snapshot and bounded section editor',()=>{
  const overlay=read('reverse/cordis.patch.yml')
  const docker=read('reverse/Dockerfile')
  const workflow=read('.github/workflows/build-reverse.yml')
  for(const p of ['reverse/prompt-manager/inspect.mjs',
    'reverse/prompt-manager/test/image-audit.mjs']) assert.ok(fs.existsSync(path.join(root,p)),p)
  assert.match(docker,/prompt-manager\/inspect\.mjs/)
  assert.match(workflow,/prompt-manager\/test\/image-audit\.mjs/)
  assert.match(overlay,/dsh-reverse-prompt-manager/)
  assert.ok(read('reverse/prompt-manager/core.mjs').includes('reverse:user-'))
  assert.ok(read('reverse/prompt-manager/index.mjs').includes('recordAssembly'))
})

test('Reverse native Prompt Manager settings module is image-owned',()=>{
  const overlay=read('reverse/cordis.patch.yml')
  const workflow=read('.github/workflows/build-reverse.yml')
  const manifest=JSON.parse(read('reverse/prompt-manager/web/package.json'))
  assert.match(overlay,/dsh-reverse-prompt-web/)
  assert.equal(manifest.name,'dsh-reverse-prompt-web')
  assert.equal(manifest.dsh.client.platform,'web')
  assert.match(read('reverse/prompt-manager/web/client.js'),/settings.section/)
  assert.match(workflow,/prompt-manager\/web\/web.test.mjs/)
})


test('Reverse Phase 2 ships read-only Electron and JS triage',()=>{
 const docker=read('reverse/Dockerfile')
 assert.match(docker,/reverse-js-triage/)
 assert.match(read('reverse/bin/reverse-js-triage'),/MAX_FILES = 250/)
 assert.ok(fs.existsSync(path.join(root,'reverse/tests/test_js_triage.py')))
})


test('Reverse Phase 3 offline diff packaged with no execution',()=>{
 const docker=read('reverse/Dockerfile')
 assert.match(docker,/COPY --chmod=0755 reverse\/bin\/reverse-diff/)
 assert.match(read('reverse/bin/reverse-diff'),/dsh-reverse-diff\/v1/)
 assert.ok(fs.existsSync(path.join(root,'reverse/tests/test_diff.py')))
})


test('Reverse Phase 4 evidence manifest tool packaged',()=>{
 const docker=read('reverse/Dockerfile')
 assert.match(docker,/COPY --chmod=0755 reverse\/bin\/reverse-workspace/)
 assert.match(read('reverse/bin/reverse-workspace'),/dsh-reverse-workspace\/v1/)
 assert.ok(fs.existsSync(path.join(root,'reverse/tests/test_workspace.py')))
})


test('Reverse task queue is allowlisted and does not execute through shell',()=> {
 const script=read('reverse/bin/reverse-task')
 const docker=read('reverse/Dockerfile')
 assert.match(script,/shell=False/)
 assert.match(script,/fcntl\.flock/)
 assert.match(script,/dsh-reverse-task\/v1/)
 assert.match(docker,/COPY --chmod=0755 reverse\/bin\/reverse-task/)
 assert.ok(fs.existsSync(path.join(root,'reverse/tests/test_task_queue.py')))
})


test('Reverse Workbench is readonly and packaged in native client module',()=>{
 const host=read('reverse/prompt-manager/web/index.mjs')
 const view=read('reverse/prompt-manager/web/client.js')
 assert.match(host,/workbenchTasks/)
 assert.match(view,/逆向分析工作台/)
 assert.match(read('reverse/prompt-manager/web/workbench.mjs'),/symlink path is not allowed/)
 assert.ok(fs.existsSync(path.join(root,'reverse/prompt-manager/web/workbench.test.mjs')))
})


test('Reverse Workbench has a separate native settings section',()=>{
 const client=read('reverse/prompt-manager/web/client.js')
 assert.match(client,/id:'reverse-workbench'/)
 assert.match(client,/label:\(\)=> '逆向工作台'/)
 assert.match(client,/WorkbenchPanel/)
})


test('Workbench v2 ships project registry and UI integration',()=>{
 const host=read('reverse/prompt-manager/web/index.mjs')
 const client=read('reverse/prompt-manager/web/client.js')
 assert.match(host,/workbenchProjectCreate/)
 assert.match(client,/分析项目/)
 assert.match(client,/workbenchProjects/)
 assert.ok(fs.existsSync(path.join(root,'reverse/prompt-manager/web/projects.test.mjs')))
})


test('Workbench project sample, task and evidence linking is packaged',()=>{
 const backend=read('reverse/prompt-manager/web/index.mjs')
 assert.match(backend,/workbenchProjectAttach/)
 assert.match(read('reverse/prompt-manager/web/client.js'),/关联到项目/)
 assert.ok(fs.existsSync(path.join(root,'reverse/prompt-manager/web/project-links.test.mjs')))
})


test('Workbench project-scoped queued tasks and evidence reconciliation',()=>{
 const host=read('reverse/prompt-manager/web/index.mjs')
 const view=read('reverse/prompt-manager/web/client.js')
 assert.match(host,/workbenchProjectTaskCreate/)
 assert.match(host,/workbenchProjectResultsSync/)
 assert.match(view,/同步已完成任务的证据/)
 assert.ok(fs.existsSync(path.join(root,'reverse/prompt-manager/web/project-tasks.test.mjs')))
})


test('Workbench guarded single task execution',()=>{
 assert.match(read('reverse/prompt-manager/web/task-runner.mjs'),/DSH_REVERSE_WEB_EXECUTION/)
 assert.match(read('reverse/bin/reverse-task'),/--expected-id/)
 assert.ok(fs.existsSync(path.join(root,'reverse/prompt-manager/web/task-runner.test.mjs')))
})
