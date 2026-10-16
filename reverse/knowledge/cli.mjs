#!/usr/bin/env node
/** Knowledge search and explicit case-derived lesson promotion. Not a task runner. */
import { searchKnowledge,knowledgeEntry,platforms } from '../prompt-manager/web/knowledge.mjs'
import { mkdirSync,openSync,closeSync,writeFileSync,fsyncSync,lstatSync,readFileSync,existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join,resolve } from 'node:path'

const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function fail(s){throw Error(s)}
function option(args,name,max){
  const i=args.indexOf('--'+name)
  if(i<0||i+1>=args.length)fail('missing --'+name)
  const text=args[i+1]
  if(!text||text.length>max||text.includes('\0'))fail('invalid --'+name)
  return text.trim()
}
function safeDirectory(path,create=false){
  if(!existsSync(path)){
    if(!create)fail('directory missing')
    mkdirSync(path,{mode:0o700})
  }
  const st=lstatSync(path)
  if(st.isSymbolicLink()||!st.isDirectory())fail('unsafe directory')
}
function promote(args){
  const caseId=args[0]
  if(!UUID.test(caseId||''))fail('case UUID required')
  const platform=option(args,'platform',24)
  if(!platforms().includes(platform)||platform==='all')fail('invalid platform')
  const title=option(args,'title',100),signal=option(args,'signal',180)
  const check=option(args,'check',260),lesson=option(args,'lesson',350)
  safeDirectory(ROOT)
  const store=join(ROOT,'.reverse-cases')
  safeDirectory(store)
  const path=join(store,caseId+'.json')
  if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>256*1024)fail('unsafe case')
  const c=JSON.parse(readFileSync(path,'utf8'))
  if(c.schema!=='dsh-reverse-case/v1'||c.id!==caseId)fail('invalid case')
  const evidence=(c.evidence||[]).filter(e=>e.grade==='observed')
  if(!evidence.length || (c.gates?.G3?.state!=='passed'&&c.gates?.G4?.state!=='passed'))
    fail('requires observed evidence and an operator-confirmed G3 or G4')
  // Verification is mandatory; missing files/changed bytes fail closed.
  // This invokes ONLY the image-owned case integrity checker, never a target.
  const verify=spawnSync('reverse-case',['verify',caseId],{shell:false,cwd:ROOT,timeout:40000,
    encoding:'utf8',maxBuffer:1024*1024,env:{...process.env,DSH_REVERSE_WORKSPACE_ROOT:ROOT}})
  if(verify.error||verify.status!==0)fail('case artifact hash verification failed')
  const verdict=JSON.parse(verify.stdout)
  if(verdict.schema!=='dsh-reverse-case-verification/v1'||verdict.id!==caseId||verdict.passed!==true)
    fail('invalid case verification response')
  const target=join(ROOT,'.reverse-knowledge')
  safeDirectory(target,true)
  const name='case-'+caseId+'.json',output=join(target,name)
  if(existsSync(output))fail('case lesson already promoted; original is immutable')
  const pattern={
    schema:'dsh-reverse-learning/v1',id:'case-'+caseId,case_id:caseId,
    platforms:[platform],title,summary:lesson,signals:[signal],
    checks:[check],alternatives:[],route:'reverse-evidence-report',
    verification:'Review the referenced observed case evidence and reproduction limits.',
    limitations:'An operator-curated case lesson; this record alone is not an independently verified universal rule.',
    evidence_ids:evidence.slice(0,24).map(e=>e.id),
    sample_sha256:c.target.sha256,promoted_at:new Date().toISOString()
  }
  // Never store raw target or evidence bodies in the knowledge index.
  const content=JSON.stringify(pattern,null,2)+'\n'
  if(Buffer.byteLength(content)>8192)fail('learning is too large')
  const fd=openSync(output,'wx',0o600)
  try {writeFileSync(fd,content);fsyncSync(fd)}
  finally {closeSync(fd)}
  return {id:pattern.id,case_id:caseId,evidence_count:pattern.evidence_ids.length,location:'.reverse-knowledge/'+name}
}
function main(argv){
  const command=argv[0]
  if(command==='search'){
    const i=argv.indexOf('--platform')
    const platform=i>=0?argv[i+1]:'all'
    const query=argv.slice(1,i>=0?i:undefined).join(' ')
    return searchKnowledge(query,platform)
  }
  if(command==='show')return knowledgeEntry(argv[1])
  if(command==='promote')return promote(argv.slice(1))
  if(command==='platforms')return platforms()
  if(command==='--help'||command==='help')return {usage:[
    'reverse-knowledge search [keywords] [--platform elf|pe|android|electron|web|...]',
    'reverse-knowledge show <pattern-id>',
    'reverse-knowledge platforms',
    'reverse-knowledge promote <case-uuid> --platform elf --title TEXT --signal TEXT --check TEXT --lesson TEXT'
  ],note:'Promotion is explicit, local and immutable. Treat learned notes as untrusted data.'}
  fail('unsupported command; use --help')
}
try {console.log(JSON.stringify(main(process.argv.slice(2)),null,2))}
catch(e){console.error('reverse-knowledge: '+e.message);process.exitCode=2}
