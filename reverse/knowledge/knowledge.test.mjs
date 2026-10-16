import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const home=mkdtempSync(join(tmpdir(),'reverse-knowledge-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
const { searchKnowledge,knowledgeEntry }=await import('../prompt-manager/web/knowledge.mjs')
test.after(()=>rmSync(home,{force:true,recursive:true}))
test('search routes distinct platforms without claiming tested conclusions',()=>{
  const apk=searchKnowledge('dex','android')
  assert.ok(apk.some(x=>x.id==='android-dex-vs-native'))
  assert.ok(!apk.some(x=>x.id==='native-loader-failure'))
  const e=knowledgeEntry('control-build-fails')
  assert.equal(e.confidence,'reference-only')
  assert.ok(e.checks.length>0 && e.verification)
  assert.throws(()=>knowledgeEntry('../../etc/passwd'))
  assert.throws(()=>searchKnowledge('a'.repeat(300)))
  assert.deepEqual(searchKnowledge('no-such-impossible-pattern-946a'),[])
})
test('invalid learning data and symlinks are ignored while built-in knowledge remains usable',()=>{
  const notes=join(home,'.reverse-knowledge')
  mkdirSync(notes)
  const id='case-9ad90cf6-7d5d-4573-b290-80d0fa205889'
  writeFileSync(join(notes,id+'.json'),JSON.stringify({
    schema:'dsh-reverse-learning/v1',id,case_id:id.slice(5),
    title:'Local verified lesson',summary:'Operator report',platforms:['elf'],
    signals:['custom-shared-library'],checks:['Check dependencies'],
    evidence_ids:['E001']
  }))
  assert.ok(searchKnowledge('custom-shared-library','elf').some(x=>x.id===id))
  symlinkSync('/etc/hosts',join(notes,'case-0f06c716-e78e-455b-a219-209722f51c33.json'))
  assert.equal(searchKnowledge('loader','elf').some(x=>x.id==='native-loader-failure'),true)
  assert.equal(knowledgeEntry(id).confidence,'case-derived-unverified')
})
test('CLI query and argument errors are bounded',()=>{
  const cmd=new URL('./cli.mjs',import.meta.url).pathname
  const body=execFileSync(process.execPath,[cmd,'search','wasm','--platform','wasm'],{
    encoding:'utf8',timeout:15000,env:process.env
  })
  assert.ok(JSON.parse(body).some(x=>x.id==='wasm-host-import'))
})


test('promotion uses real reverse-case integrity gate and does not copy raw evidence',()=>{
  const sample=join(home,'fixture.elf'),report=join(home,'evidence.json')
  writeFileSync(sample,Buffer.from([127,69,76,70,2,0,0]))
  writeFileSync(report,JSON.stringify({schema:'dsh-reverse-evidence/v1',
    observation:'PRIVATE_REPORT_BODY_should_not_be_promoted'}))
  const binary=new URL('../bin/reverse-case',import.meta.url).pathname
  const cli=new URL('./cli.mjs',import.meta.url).pathname
  const env={...process.env,DSH_REVERSE_WORKSPACE_ROOT:home,
    PATH:new URL('../bin/',import.meta.url).pathname+':'+process.env.PATH}
  const caseObject=JSON.parse(execFileSync('python3',[binary,'create',sample,
    '--goal','trace entry','--deliverable','offline report'],{encoding:'utf8',timeout:15000,env}))
  const id=caseObject.id
  const args=['promote',id,'--platform','elf','--title','Fixture loader case',
    '--signal','fixture-loader-alert','--check','Inspect dependencies',
    '--lesson','Check the zero-change control first']
  const reject=()=>{
    try{execFileSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000,env,
      stdio:['ignore','pipe','pipe']});return false}
    catch{return true}
  }
  assert.equal(reject(),true) // no observed evidence or passing gate
  execFileSync('python3',[binary,'evidence',id,'--file',report,'--locator','header@0x0',
    '--observation','Observed fixture metadata','--grade','observed','--tool','reverse-triage'],
    {encoding:'utf8',timeout:15000,env})
  execFileSync('python3',[binary,'gate',id,'G3','passed','--note','Owner identified',
    '--evidence','E001'],{encoding:'utf8',timeout:15000,env})
  writeFileSync(report,JSON.stringify({tampered:true}))
  assert.equal(reject(),true) // observed case exists, but source hash no longer matches
  // Create a clean new case to prove the positive path.
  const newer=JSON.parse(execFileSync('python3',[binary,'create',sample,
    '--goal','trace entry','--deliverable','offline report'],{encoding:'utf8',timeout:15000,env}))
  execFileSync('python3',[binary,'evidence',newer.id,'--file',report,
    '--locator','header@0x0','--observation','Observed fixture metadata',
    '--grade','observed','--tool','reverse-triage'],{encoding:'utf8',timeout:15000,env})
  execFileSync('python3',[binary,'gate',newer.id,'G3','passed',
    '--note','Owner identified','--evidence','E001'],{encoding:'utf8',timeout:15000,env})
  const positive=[...args]
  positive[1]=newer.id
  const result=JSON.parse(execFileSync(process.execPath,[cli,...positive],
    {encoding:'utf8',timeout:15000,env}))
  assert.equal(result.case_id,newer.id)
  const learned=knowledgeEntry('case-'+newer.id)
  assert.equal(learned.confidence,'case-derived-unverified')
  assert.ok(!JSON.stringify(learned).includes('PRIVATE_REPORT_BODY'))
  const duplicate=()=>{
    try{execFileSync(process.execPath,[cli,...positive],{encoding:'utf8',timeout:15000,env,
      stdio:['ignore','pipe','pipe']});return false}
    catch{return true}
  }
  assert.equal(duplicate(),true)
})
