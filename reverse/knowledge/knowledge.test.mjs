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
