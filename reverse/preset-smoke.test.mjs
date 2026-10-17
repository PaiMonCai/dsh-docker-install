import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, verifyPresets } from './preset-smoke.mjs'

function fixture(rows, create = id => ({ sessionId: 'session-' + id })) {
  const calls = []
  return {
    calls,
    agentPresets: { list: async () => rows },
    sessionController: { create: async options => {
      calls.push(options)
      return create(options.agentPreset)
    } },
  }
}

const ready = [
  { id: 'reverse-engineering', broken: false },
  { id: 'reverse-report-reader', broken: false },
]

test('runtime acceptance requires session creation for both Reverse presets', async () => {
  const ctx = fixture(ready)
  assert.equal(await verifyPresets(ctx), true)
  assert.deepEqual(ctx.calls, ready.map(row => ({
    cwd: process.cwd(), agentPreset: row.id,
  })))
})

test('missing or broken reader prevents a false successful readiness check', async () => {
  for (const rows of [ready.slice(0, 1), [ready[0], { ...ready[1], broken: true }]]) {
    const ctx = fixture(rows)
    assert.equal(await verifyPresets(ctx), false)
    assert.equal(ctx.calls.length, 0)
  }
})

test('report reader session creation failure fails the combined acceptance', async () => {
  const ctx = fixture(ready, id => id === 'reverse-report-reader' ? {} : { sessionId: 'ok' })
  await assert.rejects(verifyPresets(ctx), /reverse-report-reader:.*invalid session id/)
  assert.equal(ctx.calls.length, 2)
})

test('report reader activation errors are not hidden by a healthy engineering Agent', async () => {
  const ctx = fixture(ready, id => {
    if (id === 'reverse-report-reader') throw Error('reader dependency unavailable')
    return { sessionId: 'ok' }
  })
  await assert.rejects(verifyPresets(ctx), /reader dependency unavailable/)
})

test('normal startup does not run CI session creation', t => {
  const previous = process.env.DSH_REVERSE_CI_VERIFY_PRESET
  delete process.env.DSH_REVERSE_CI_VERIFY_PRESET
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_REVERSE_CI_VERIFY_PRESET
    else process.env.DSH_REVERSE_CI_VERIFY_PRESET = previous
  })
  apply({ effect() { assert.fail('CI smoke must be disabled during normal startup') } })
})
