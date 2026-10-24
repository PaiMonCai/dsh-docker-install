import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepare, summarize } from '../ci/context-manager-comparison.mjs'

async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),'dsh-context-comparison-'))
  try {
    const directory=join(root,'experiment')
    await prepare(directory)
    const results=JSON.parse(await readFile(join(directory,'results.json'),'utf8'))
    const manifest=JSON.parse(await readFile(join(directory,'workload.json'),'utf8'))
    results.conditions={imageDigest:'ghcr.io/example/dsh@sha256:'+'a'.repeat(64),provider:'offline',model:'synthetic',
      modelParameters:{temperature:0},billionVersion:'test-only',limits:{maxCost:10,currency:'USD',maxMinutes:20}}
    results.runs.forEach((trial,i)=>{
      trial.status='complete';trial.sessionIdHash=i.toString(16).padStart(64,'0')
      trial.observed=Object.fromEntries(['imageDigest','provider','model','modelParameters'].map(key=>[key,results.conditions[key]]))
      trial.externalVersion=trial.arm==='billion'?'test-only':null
      trial.durationMs=100;trial.charge={amount:1,currency:'USD'}
      trial.requests=[{schema:'openai-chat',usage:{prompt_tokens:100,completion_tokens:10,prompt_tokens_details:{cached_tokens:40}}}]
      trial.quality={verified:true,passed:true,notes:'Synthetic reporter fixture, not a real experiment'}
      trial.answer=structuredClone(manifest.expected)
    })
    await run({directory,results,manifest})
  } finally {await rm(root,{recursive:true,force:true})}
}

test('the fixed workload has twelve independent paired trials and does not replace prior output',()=>fixture(async({directory,results,manifest})=>{
  assert.equal(results.runs.length,12)
  const rows=JSON.parse(await readFile(join(directory,'records-8.json'),'utf8'))
  assert.equal(rows.at(-1).units,manifest.expected.lastRecordUnits)
  await assert.rejects(()=>prepare(directory),/EEXIST/)
  const report=summarize(results,manifest)
  assert.equal(report.allTasksPassed,true)
  assert.deepEqual(report.groups[0].usage,{input:400,cached:160,output:40})
  assert.equal(report.productionApproved,false)
}))

test('missing cache usage and absent request observations never become zero-cost evidence',()=>fixture(({results,manifest})=>{
  results.runs[0].requests=[{schema:'openai-chat',usage:{prompt_tokens:100,completion_tokens:10}}]
  results.runs[3].requests=[]
  results.runs[0].charge=null
  const report=summarize(results,manifest)
  assert.equal(report.groups[0].usage,null)
  assert.equal(report.groups[0].unknownRequests,1)
  assert.equal(report.groups[0].trialsMissingUsage,1)
  assert.equal(report.groups[0].providerCharge,null)
  assert.equal(report.comparisons[0].inputReductionPct,null)
  assert.equal(report.comparisons[0].chargeReductionPct,null)
}))

test('different conditions, repeated Sessions and missing pairs invalidate the comparison',()=>fixture(({results,manifest})=>{
  const wrong=structuredClone(results);wrong.runs[1].observed.model='different'
  assert.throws(()=>summarize(wrong,manifest),/conditions differ/)
  const reused=structuredClone(results);reused.runs[1].sessionIdHash=reused.runs[0].sessionIdHash
  assert.throws(()=>summarize(reused,manifest),/independent Sessions/)
  const missing=structuredClone(results);missing.runs.pop()
  assert.throws(()=>summarize(missing,manifest),/all paired trials/)
  const external=structuredClone(results);external.runs[2].externalVersion='unpinned'
  assert.throws(()=>summarize(external,manifest),/external plugin version/)
}))

test('quality regression, failed trials and unreviewed code prevent a savings conclusion',()=>fixture(({results,manifest})=>{
  const wrong=structuredClone(results)
  wrong.runs.find(run=>run.arm==='builtin'&&run.task==='large-result').answer.northUnits++
  assert.equal(summarize(wrong,manifest).comparisons[0].qualityComparable,false)
  const failed=structuredClone(results);failed.runs[1].status='failed'
  assert.equal(summarize(failed,manifest).comparisons[0].elapsedReductionPct,null)
  const unreviewed=structuredClone(results);unreviewed.runs[1].quality.verified=false
  assert.equal(summarize(unreviewed,manifest).groups[1].qualityPassed,false)
  const pending=structuredClone(results);pending.runs[1].status='pending'
  assert.equal(summarize(pending,manifest).groups[1].usage,null)
}))

test('the CLI verifies original workload bytes before writing a result',()=>fixture(async({directory,results})=>{
  await writeFile(join(directory,'results.json'),JSON.stringify(results))
  const cli=()=>spawnSync(process.execPath,['ci/context-manager-comparison.mjs','report',directory],{encoding:'utf8'})
  const valid=cli()
  assert.equal(valid.status,0,valid.stderr)
  const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'))
  assert.deepEqual(report.comparisons[2],{baseline:'billion',arm:'builtin',qualityComparable:true,
    inputReductionPct:0,elapsedReductionPct:0,chargeReductionPct:0})
  await writeFile(join(directory,'records-1.json'),'[]')
  const changed=cli()
  assert.notEqual(changed.status,0)
  assert.match(changed.stderr,/original workload changed/)
}))

test('the maintenance task detects the shipped defects and accepts a conforming repair',()=>fixture(async({directory})=>{
  const env={...process.env}
  // A nested test runner needs its own process context, not the parent's worker marker.
  delete env.NODE_TEST_CONTEXT
  const check=()=>spawnSync(process.execPath,['--test','select.test.mjs'],{cwd:directory,encoding:'utf8',env})
  assert.notEqual(check().status,0)
  await writeFile(join(directory,'select.mjs'),`export function select(items,budget){
    if(!Number.isSafeInteger(budget)||budget<0)throw Error('budget')
    const seen=new Set()
    for(const item of items){
      if(typeof item.id!=='string'||!item.id||seen.has(item.id)||!Number.isSafeInteger(item.priority)||item.priority<0||
        !Number.isSafeInteger(item.units)||item.units<=0)throw Error('item')
      seen.add(item.id)
    }
    const result=[]
    for(const item of [...items].sort((a,b)=>b.priority-a.priority))if(item.units<=budget){
      budget-=item.units;result.push(item.id)
    }
    return result
  }`)
  const fixed=check()
  assert.equal(fixed.status,0,fixed.stdout+fixed.stderr)
}))
