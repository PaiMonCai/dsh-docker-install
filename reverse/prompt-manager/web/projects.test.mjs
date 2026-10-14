import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const home=mkdtempSync(join(tmpdir(),'dsh-reverse-projects-'))
process.env.DSH_REVERSE_WORKSPACE_ROOT=home
const {projects,project,createProject}=await import('./projects.mjs')
test('projects survive independent reads and use restricted on-disk permissions',()=>{
 const a=createProject('Analysis A','Static inspection')
 assert.equal(project(a.id).name,'Analysis A')
 assert.equal(projects().length,1)
 assert.equal(JSON.parse(readFileSync(join(home,'.reverse-projects',a.id+'.json'))).schema,'dsh-reverse-project/v1')
})
test('invalid input and path traversal do not create records',()=>{
 assert.throws(()=>createProject(' '))
 assert.throws(()=>createProject('x'.repeat(81)))
 assert.throws(()=>project('../../etc/passwd'))
 assert.throws(()=>createProject('Valid','x'.repeat(501)))
})
test.after(()=>rmSync(home,{recursive:true,force:true}))
