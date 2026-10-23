import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeProviderUsage } from '../docker/plugins/dsh-context-manager/cache-ledger.mjs'

export const arms = ['native', 'builtin', 'billion']
export const tasks = ['code-maintenance', 'large-result']
const hash = value => createHash('sha256').update(value).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'

export function workload() {
  const rows = Array.from({ length: 12000 }, (_, i) => ({
    id: 'record-' + i, region: ['north', 'south', 'east', 'west'][i % 4],
    units: (i * 17 + 11) % 997, revision: i % 7,
    note: 'Synthetic source evidence ' + i + '. Preserve record identities and revision boundaries.',
  }))
  const expected = {
    recordCount: rows.length,
    northUnits: rows.filter(row => row.region === 'north').reduce((sum, row) => sum + row.units, 0),
    lastRecordUnits: rows.at(-1).units,
    revisionSixCount: rows.filter(row => row.revision === 6).length,
  }
  return { rows, expected }
}

export async function prepare(directory) {
  // Refuse an existing destination so an unfinished experiment cannot be replaced.
  await mkdir(directory)
  const { rows, expected } = workload()
  const chunks = Array.from({ length: 8 }, (_, i) => json(rows.slice(i * 1500, (i + 1) * 1500)))
  const source = `export function select(items, budget) {
  return items.sort((a, b) => b.priority - a.priority).filter(item => item.units <= budget)
}
`
  const spec = `Implement select(items, budget) in select.mjs. A budget is a nonnegative safe integer.
Reject invalid budgets. Every item has a unique nonempty string id, a nonnegative safe-integer
priority and positive safe-integer units; reject invalid or duplicate items. Visit items by
descending priority, preserving input order for ties. Select an item only if its units fit
the REMAINING budget, then deduct its units; continue considering later items. Return selected
IDs in visit order. Never mutate the input. Do not modify the tests or this specification.
`
  const testSource = `import test from 'node:test'
import assert from 'node:assert/strict'
import {select} from './select.mjs'
test('remaining budget and stable ties',()=>{
 const items=[{id:'a',priority:2,units:8},{id:'b',priority:2,units:6},{id:'c',priority:1,units:2}]
 const before=JSON.stringify(items)
 assert.deepEqual(select(items,10),['a','c'])
 assert.equal(JSON.stringify(items),before)
})
test('skip oversized items and preserve input',()=>{
 const items=[{id:'low',priority:1,units:2},{id:'high',priority:5,units:20},{id:'mid',priority:3,units:4}]
 const before=JSON.stringify(items)
 assert.deepEqual(select(items,6),['mid','low'])
 assert.equal(JSON.stringify(items),before)
 assert.deepEqual(select(items,0),[])
})
test('invalid budgets and items fail explicitly',()=>{
 for(const budget of [-1,1.5,NaN,Infinity,'10',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>select([],budget))
 for(const items of [[{id:'',priority:1,units:1}],[{id:'x',priority:1,units:0}],
  [{id:'x',priority:-1,units:1}],[{id:'x',priority:1,units:1},{id:'x',priority:2,units:2}]])
  assert.throws(()=>select(items,10))
})
`
  const files = { 'select.mjs': source, 'select.test.mjs': testSource, 'SPEC.txt': spec }
  chunks.forEach((chunk, i) => { files['records-' + (i + 1) + '.json'] = chunk })
  const inventory = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, hash(content)]))
  const workloadSha256 = hash(json(inventory))
  const runs = []
  for (let repetition = 1; repetition <= 2; repetition++) {
    for (const task of tasks) for (const arm of repetition === 1 ? arms : [...arms].reverse()) {
      runs.push({ id: task + '-' + repetition + '-' + arm, task, arm, repetition,
        status: 'pending', sessionIdHash: null, observed: null, externalVersion: null, requests: [], durationMs: null,
        quality: { verified: false, passed: null, notes: '' }, answer: null, charge: null })
    }
  }
  const results = { schemaVersion: 1, workloadSha256, conditions: {
    imageDigest: null, provider: null, model: null, modelParameters: {}, billionVersion: null,
    limits: { maxCost: null, currency: null, maxMinutes: null, enforcement: 'operator' },
  }, runs }
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(directory, name), content)
  await writeFile(resolve(directory, 'workload.json'), json({ schemaVersion: 1, workloadSha256, files: inventory, expected }))
  await writeFile(resolve(directory, 'results.json'), json(results))
  await writeFile(resolve(directory, 'TASKS.md'), `# Fixed comparison tasks

Use a fresh Session and workspace for EVERY row in results.json. Retain the same image digest,
provider, exact model, model parameters, permissions and input files across all three arms.
Enable only the selected context owner: native Basic, built-in enhancement, or upstream billion.
For the billion arm also pin and record the external plugin version in quality.notes.
The prepared order reverses on the second repetition. Do not reuse a compressed Session.

## Code maintenance

Turn 1: Read SPEC.txt and select.mjs. Explain the intended invariants without editing files.
Turns 2-9, one per turn: Read records-N.json (N = 1..8), keep the spec in mind and summarize
that chunk's data boundaries. These are deliberately large, synthetic intervening tool results.
Turn 10: Fix select.mjs according to the ORIGINAL specification, run node --test select.test.mjs,
and report the result. Verify the test/spec hashes against workload.json and review the patch
before recording quality.verified=true and quality.passed. Keep the test output locally.

## Large-result reading

Turn 1: Request exact totals across all eight records-N.json files: recordCount, northUnits,
lastRecordUnits, revisionSixCount. Do not read workload.json (the answer key).
Turns 2-9, one per turn: Read records-N.json (N = 1..8). Preserve source identities and the goal.
Turn 10: Return one JSON object with exactly those four integer fields. Record it in answer.
The report checks these against the deterministic source data; do not supply estimated totals.

## Measurements

Fill conditions and its operator-enforced cost/time limits BEFORE any paid request. Copy the
same observed imageDigest/provider/model/modelParameters into each run. Hash Session IDs locally
with SHA-256; do not export raw Sessions. Record all provider requests, including retries and
summary calls, as {schema,usage}; schema is dsh, openai-chat, openai-responses or anthropic.
Missing cache counters remain unknown. durationMs is whole-task elapsed time, never TTFT.
Charge is null unless independently available from the provider, otherwise {amount,currency}.
Set status to complete, failed or cancelled. Explain code-quality review in quality.notes.
Use acp_cache only as a supplementary observation, not as a provider bill.
Run node ci/context-manager-comparison.mjs report DIRECTORY from the source checkout.
This tool prepares and reports observations; it never invokes a model or enforces spending caps.
`)
  return { directory, workloadSha256, trials: runs.length }
}

function finite(value, label) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0, label)
  return value
}

export function summarize(results, manifest) {
  assert.equal(results.schemaVersion, 1)
  assert.equal(results.workloadSha256, manifest.workloadSha256)
  const { conditions, runs } = results
  assert.match(conditions.imageDigest, /@sha256:[a-f0-9]{64}$/)
  for (const name of ['provider', 'model']) assert.ok(typeof conditions[name] === 'string' && conditions[name].trim())
  finite(conditions.limits.maxCost, 'record a cost ceiling before running')
  finite(conditions.limits.maxMinutes, 'record a time ceiling before running')
  assert.ok(typeof conditions.limits.currency === 'string' && conditions.limits.currency.length > 0)
  const observed = Object.fromEntries(['imageDigest', 'provider', 'model', 'modelParameters'].map(key => [key, conditions[key]]))
  const identities = new Set(), sessions = new Set()
  const key = run => [run.task, run.repetition, run.arm].join('/')
  for (const run of runs) {
    assert.ok(arms.includes(run.arm) && tasks.includes(run.task) && [1, 2].includes(run.repetition))
    assert.ok(!identities.has(key(run)), 'duplicate trial')
    identities.add(key(run))
    assert.ok(['pending', 'complete', 'failed', 'cancelled'].includes(run.status))
    if (run.status === 'pending') continue
    assert.deepEqual(run.observed, observed, 'trial conditions differ')
    if (run.arm === 'billion') {
      assert.ok(typeof conditions.billionVersion === 'string' && conditions.billionVersion.trim())
      assert.equal(run.externalVersion, conditions.billionVersion, 'pin the external plugin version')
    }
    assert.match(run.sessionIdHash, /^[a-f0-9]{64}$/)
    assert.ok(!sessions.has(run.sessionIdHash), 'trials must use independent Sessions')
    sessions.add(run.sessionIdHash)
    finite(run.durationMs, 'durationMs must be observed')
    assert.ok(Array.isArray(run.requests))
    if (run.charge !== null) {
      finite(run.charge.amount, 'invalid provider charge')
      assert.equal(run.charge.currency, conditions.limits.currency, 'do not combine currencies')
    }
  }
  assert.equal(identities.size, arms.length * tasks.length * 2, 'all paired trials must be present')
  const groups = arms.map(arm => {
    const selected = runs.filter(run => run.arm === arm)
    const complete = selected.every(run => run.status === 'complete')
    const usage = selected.flatMap(run => run.requests.map(request => normalizeProviderUsage(request.usage, { schema: request.schema })))
    const known = complete && selected.every(run => run.requests.length > 0) && usage.every(row => row.known)
    const qualityPassed = complete && selected.every(run => run.task === 'large-result'
      ? Object.keys(manifest.expected).length === Object.keys(run.answer ?? {}).length &&
        Object.entries(manifest.expected).every(([name, value]) => run.answer?.[name] === value)
      : run.quality.verified === true && run.quality.passed === true)
    const chargeKnown = complete && selected.every(run => run.charge !== null)
    return { arm, trials: selected.length, complete, qualityPassed,
      requestsWithCompleteUsage: usage.filter(row => row.known).length, unknownRequests: usage.filter(row => !row.known).length,
      trialsMissingUsage: selected.filter(run => run.requests.length === 0).length,
      usage: known ? { input: usage.reduce((n, row) => n + row.input, 0), cached: usage.reduce((n, row) => n + row.cached, 0),
        output: usage.reduce((n, row) => n + row.output, 0) } : null,
      totalDurationMs: complete ? selected.reduce((n, row) => n + row.durationMs, 0) : null,
      providerCharge: chargeKnown ? selected.reduce((n, row) => n + row.charge.amount, 0) : null }
  })
  const reduction = (before, after) => before > 0 && after !== null ? 100 * (1 - after / before) : null
  const comparisons = [['native', 'builtin'], ['native', 'billion'], ['billion', 'builtin']].map(([from, to]) => {
    const baseline = groups.find(group => group.arm === from)
    const group = groups.find(group => group.arm === to)
    const qualityComparable = baseline.qualityPassed && group.qualityPassed
    return { baseline: from, arm: to, qualityComparable,
      inputReductionPct: qualityComparable ? reduction(baseline.usage?.input ?? null, group.usage?.input ?? null) : null,
      elapsedReductionPct: qualityComparable ? reduction(baseline.totalDurationMs, group.totalDurationMs) : null,
      chargeReductionPct: qualityComparable ? reduction(baseline.providerCharge, group.providerCharge) : null }
  })
  return { schemaVersion: 1, scope: 'operator-recorded-synthetic-task-comparison', workloadSha256: results.workloadSha256,
    currency: conditions.limits.currency, limitsEnforcedBy: 'operator', groups,
    comparisons,
    allTasksPassed: groups.every(group => group.qualityPassed), productionApproved: false }
}

async function main() {
  const [command, path] = process.argv.slice(2)
  assert.ok(path && ['prepare', 'report'].includes(command), 'usage: node ci/context-manager-comparison.mjs prepare|report DIRECTORY')
  const directory = resolve(path)
  if (command === 'prepare') console.log(json(await prepare(directory)))
  else {
    const manifest = JSON.parse(await readFile(resolve(directory, 'workload.json'), 'utf8'))
    const results = JSON.parse(await readFile(resolve(directory, 'results.json'), 'utf8'))
    assert.equal(hash(json(manifest.files)), manifest.workloadSha256, 'workload inventory changed')
    for (const [name, expected] of Object.entries(manifest.files)) {
      assert.equal(hash(await readFile(resolve(directory, name))), expected, 'original workload changed: ' + name)
    }
    const report = summarize(results, manifest)
    await writeFile(resolve(directory, 'report.json'), json(report))
    console.log(json(report))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
