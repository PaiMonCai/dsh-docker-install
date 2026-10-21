import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { baselineRoot, loadAdapter, readFixture, probeLegacySession, probeTieredAdapter,
  Session, SessionId, appendPluginRecord } from '../ci/acp-kernel-audit/compatibility.mjs'
import { changedValues, compareApis } from '../ci/acp-kernel-audit/api-diff.mjs'

for (const [label, root] of [['published baseline', baselineRoot],
  ['pinned source candidate', process.env.ACP_AUDIT_CANDIDATE]]) {
  test(label + ': frozen old DSH log survives cold replay, missing ACK and seeded fork',
    { skip: !root && 'candidate requires the isolated audit build' }, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-acp-m0-test-'))
      try {
        const adapter = await loadAdapter(resolve(root), directory)
        const fixture = await readFixture()
        assert.equal(fixture.provenance.synthetic, true)
        assert.equal(fixture.provenance.kernel, '0.0.101')
        assert.ok(Object.keys(fixture.expected.refs).some(raw => Number(raw) > 12), 'exercise sparse event sequences')
        const result = await probeLegacySession(adapter, fixture)
        assert.ok(Object.values(result).every(value => value === true))
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  test(label + ': T1/T2/T3 bridge retains exact originals through cold replay',
    { skip: !root && 'candidate requires the isolated audit build' }, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-acp-m0-tiers-'))
      try {
        const result = await probeTieredAdapter(await loadAdapter(resolve(root), directory))
        assert.deepEqual(result.tiers, [1, 2, 3])
        assert.equal(result.originalCount, 8)
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
}

test('legacy recovery refuses a forged checkpoint and mismatched intent provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-acp-m0-corrupt-'))
  try {
    const adapter = await loadAdapter(baselineRoot, directory)
    for (const mutate of [
      events => { events.at(-1).data.error = 'synthetic native failure' },
      events => { events.findLast(e => e.type === adapter.INTENT_EVENT).data.startSeq = 99999 },
      events => { events.findLast(e => e.type === 'user/message').sourceEventSeqs = [0] },
    ]) {
      const fixture = await readFixture()
      const events = fixture.events.slice(0, -1)
      mutate(events)
      if (events.at(-1).data.error) {
        const session = Session.create(SessionId(fixture.header.id), events, fixture.header)
        assert.equal(adapter.replayAcpState(session).lastResult.block, 'b2', 'failed transaction keeps previous state')
      } else {
        assert.throws(() => adapter.replayAcpState(Session.create(SessionId(fixture.header.id), events, fixture.header)),
          /provenance mismatch|missing valid summary checkpoint|sourceEventSeqs/)
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('CCR retains exact original on missing durability and never resolves another Session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-acp-m0-ccr-'))
  try {
    const adapter = await loadAdapter(baselineRoot, directory)
    const session = Session.create(SessionId('m0-no-writer'))
    const result = { isError: false, content: [{ type: 'text', text: 'synthetic exact result '.repeat(64) }] }
    const original = structuredClone(result)
    assert.equal(await adapter.offloadCcr({ agent: { session }, name: 'read', callId: 'm0' }, result,
      { appendRecord: appendPluginRecord, flush: async () => false, minChars: 128 }), null)
    assert.deepEqual(result, original)
    assert.throws(() => adapter.retrieveCcr(Session.create(SessionId('m0-other')), { ref: 'ccr:0' }), /unavailable/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('API diff reports removals, changed signatures, removed defaults and new optional state', () => {
  assert.deepEqual(changedValues({ keep: 1, removed: false }, { keep: 1, added: 2 }), [
    { path: 'added', before: null, after: 2 }, { path: 'removed', before: false, after: null },
  ])
  const before = { runtimeExports: ['keep', 'old'], declarations: { keep: { sha256: 'a' } },
    defaults: { gate: false }, initialState: {}, coreMethods: ['search'], exports: { '.': 'a' } }
  const after = { ...before, runtimeExports: ['keep', 'new'], declarations: { keep: { sha256: 'b' } },
    defaults: { gate: true }, initialState: { optional: [] } }
  const diff = compareApis(before, after)
  assert.deepEqual(diff.runtimeRemoved, ['old'])
  assert.deepEqual(diff.runtimeAdded, ['new'])
  assert.equal(diff.declarationsChanged[0].name, 'keep')
  assert.equal(diff.defaultsChanged[0].path, 'gate')
  assert.equal(diff.initialStateChanged[0].path, 'optional')
})
