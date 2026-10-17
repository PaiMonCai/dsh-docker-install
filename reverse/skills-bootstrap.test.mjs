import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installSkills, SKILLS, installReportReaderSkills, REPORT_READER_SKILLS } from './skills-bootstrap.mjs'

function fixture(t) {
  const work=mkdtempSync(join(tmpdir(),'reverse-bundle-'))
  t.after(()=>rmSync(work,{recursive:true,force:true}))
  const source=join(work,'source'),home=join(work,'home')
  mkdirSync(source,{recursive:true})
  mkdirSync(home,{recursive:true})
  for(const id of SKILLS){
    mkdirSync(join(source,id),{recursive:true})
    writeFileSync(join(source,id,'SKILL.md'),'---\nname: '+id+'\ndescription: test\n---\n# test\n')
  }
  const references=join(source,'universal-reverse-core','references')
  mkdirSync(join(references,'nested'),{recursive:true})
  writeFileSync(join(references,'routing.md'),'original instructions')
  writeFileSync(join(references,'nested','gates.md'),'nested data')
  return {work,source,home,references}
}
test('installer stages complete resources including nested references',t=>{
  const f=fixture(t)
  const installed=installSkills(f.home,f.source)
  assert.equal(installed.skills.length,10)
  const dest=join(f.home,'reverse-engineering','skills','universal-reverse-core')
  assert.equal(readFileSync(join(dest,'references','routing.md'),'utf8'),'original instructions')
  assert.equal(readFileSync(join(dest,'references','nested','gates.md'),'utf8'),'nested data')
  writeFileSync(join(dest,'references','routing.md'),'user override')
  writeFileSync(join(f.references,'routing.md'),'new image version')
  installSkills(f.home,f.source)
  assert.equal(readFileSync(join(dest,'references','routing.md'),'utf8'),'user override')
  assert.equal(readFileSync(join(dest,'references','nested','gates.md'),'utf8'),'nested data')
})
test('existing user-owned Skill directory is never augmented or overwritten',t=>{
  const f=fixture(t)
  const target=join(f.home,'reverse-engineering','skills','universal-reverse-core')
  mkdirSync(target,{recursive:true})
  writeFileSync(join(target,'SKILL.md'),'custom owner')
  installSkills(f.home,f.source)
  assert.equal(readFileSync(join(target,'SKILL.md'),'utf8'),'custom owner')
  assert.equal(existsSync(join(target,'references')),false)
})
test('reader bundles and references install independently from engineering skills', t => {
  const f=fixture(t)
  const reader=installReportReaderSkills(f.home)
  assert.equal(reader.skills.length,7)
  assert.equal(new Set(reader.skills).size,7)
  assert.equal(existsSync(join(f.home,'reverse-engineering')),false)
  const engineer=installSkills(f.home,f.source)
  for(const id of REPORT_READER_SKILLS){
    assert.ok(readFileSync(join(reader.dest,id,'SKILL.md'),'utf8').startsWith('---\nname: '+id+'\n'))
    assert.equal(existsSync(join(engineer.dest,id)),false)
  }
  for(const id of SKILLS)assert.equal(existsSync(join(reader.dest,id)),false)
  assert.ok(existsSync(join(reader.dest,'reverse-report-overview','references','report-formats.md')))
  assert.ok(existsSync(join(reader.dest,'reverse-report-evidence-audit','references','claim-checks.md')))
  for(const id of ['reverse-report-triage','reverse-report-finding-check','reverse-report-sarif']){
    assert.ok(readFileSync(join(reader.dest,id,'references','attribution.md'),'utf8').includes('creativecommons.org/licenses/by-sa/4.0/'))
  }
})
test('reader installation preserves user edits and does not augment an existing user skill', t => {
  const f=fixture(t)
  const parent=join(f.home,'reverse-report-reader','skills')
  const custom=join(parent,'reverse-report-overview')
  mkdirSync(custom,{recursive:true})
  writeFileSync(join(custom,'SKILL.md'),'custom overview')
  const result=installReportReaderSkills(f.home)
  assert.equal(readFileSync(join(custom,'SKILL.md'),'utf8'),'custom overview')
  assert.equal(existsSync(join(custom,'references')),false)
  const reference=join(result.dest,'reverse-report-evidence-audit','references','claim-checks.md')
  writeFileSync(reference,'user review guidance')
  installReportReaderSkills(f.home)
  assert.equal(readFileSync(reference,'utf8'),'user review guidance')
})
test('packaged symlinks are rejected before copying any part of affected Skill',t=>{
  const f=fixture(t)
  symlinkSync(join(f.work,'outside'),join(f.references,'linked'))
  assert.throws(()=>installSkills(f.home,f.source),/Symlink in packaged Skill/)
  assert.equal(existsSync(join(f.home,'reverse-engineering','skills','universal-reverse-core')),false)
})
