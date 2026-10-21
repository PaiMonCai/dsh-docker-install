import assert from 'node:assert/strict'

// A controlled native transaction, matching the existing bridge test double.
// This exercises real Session replay, not the CompactionEngine or a provider.
export function transaction(session, adapter) {
  return { async compactRegion(start, end) {
    const covered = session.surface.nodes.slice(session.surface.nodes.indexOf(start),
      session.surface.nodes.indexOf(end) + 1)
    const compactionId = 'm0-transaction-' + session.seq
    const summary = adapter.currentAcpSummary(session).summary
    const begin = session.append('compaction/start', { compactionId, turn: null })
    const sum = session.append('compaction/summary', {
      compactionId, summary: [{ type: 'text', text: summary }],
      shadowedRange: { start, end }, shadowedSeqs: covered,
      shadowedTokenCount: 800, provider: 'synthetic', model: 'offline',
    })
    session.append('user/message', {
      id: 'checkpoint-' + compactionId, role: 'user',
      source: { kind: 'compact-checkpoint', compactionId },
      content: [{ type: 'text', text: '<compacted-summary>\n' + summary + '\n</compacted-summary>' }],
    }, { surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
      sourceEventSeqs: [begin.seq, sum.seq, ...covered] })
    session.append('compaction/end', { compactionId, turn: null })
    return { compactionId, summarySeq: sum.seq }
  } }
}

export async function probeLegacySession(adapter, fixture, { Session, SessionId, appendPluginRecord }) {
  const original = JSON.stringify(fixture)
  const restore = events => Session.create(SessionId(fixture.header.id),
    structuredClone(events), structuredClone(fixture.header))
  const session = restore(fixture.events)
  const before = JSON.stringify(session.snapshotEvents())
  const runtime = new adapter.AcpRuntime({ appendRecord: appendPluginRecord, flushIntent: async () => true })
  const status = runtime.status(session)
  assert.deepEqual(status.blocks.map(b => ({ id: b.id, tier: b.tier })), fixture.expected.blocks)
  const stored = adapter.replayAcpState(session)
  assert.deepEqual(stored.checkpoints, fixture.expected.checkpoints)
  for (const [raw, ref] of Object.entries(fixture.expected.refs)) {
    assert.equal(stored.state.messageRefs.byRaw[raw], ref)
    assert.equal(stored.state.messageRefs.byRef[ref], raw)
  }
  const sources = runtime.retrieve(session, { blockId: fixture.expected.activeBlock }).sources
  assert.equal(sources.length, fixture.expected.originals.length)
  for (const source of fixture.expected.originals) {
    assert.equal(typeof source.text, 'string', 'fixture must contain exact original text')
    const page = runtime.retrieve(session, { blockId: fixture.expected.activeBlock, ref: source.ref, limit: 8192 })
    assert.equal(page.text, source.text)
    assert.equal(page.nextOffset, null)
  }
  assert.equal(adapter.retrieveCcr(session, { ref: fixture.expected.ccr.ref, limit: 8192 }).content,
    fixture.expected.ccr.text)
  assert.throws(() => adapter.retrieveCcr(Session.create(SessionId('m0-unrelated')),
    { ref: fixture.expected.ccr.ref }), /unavailable/)
  runtime.status(session)
  runtime.decompress(session, fixture.expected.activeBlock)
  assert.equal(JSON.stringify(session.snapshotEvents()), before)
  assert.equal(JSON.stringify(fixture), original)

  // The final ACK can be absent after a crash. Recover only the closed native transaction.
  assert.equal(fixture.events.at(-1).type, adapter.STATE_EVENT)
  const crashed = restore(fixture.events.slice(0, -1))
  const crashedLog = JSON.stringify(crashed.snapshotEvents())
  const recovered = new adapter.AcpRuntime({ appendRecord: appendPluginRecord })
  const recoveredStatus = recovered.status(crashed)
  assert.equal(recoveredStatus.recoveredFromNativeLog, true)
  assert.deepEqual(recoveredStatus.blocks, status.blocks)
  assert.equal(JSON.stringify(crashed.snapshotEvents()), crashedLog)
  const unfinished = restore(fixture.events.slice(0, -2))
  assert.throws(() => new adapter.AcpRuntime({ appendRecord: appendPluginRecord }).status(unfinished), /unfinished/)

  const forkId = SessionId('m0-seeded-fork')
  const fork = Session.create(forkId, structuredClone(fixture.events),
    { ...structuredClone(fixture.header), id: forkId, isSeeded: true, parentSession: session.id }, fixture.events.length)
  const child = new adapter.AcpRuntime({ appendRecord: appendPluginRecord, flushIntent: async () => true })
  assert.deepEqual(child.status(fork).blocks, status.blocks)
  const refs = child.status(fork).refs
  child.propose(fork, { startRef: refs[0].ref, endRef: refs[1].ref,
    summary: 'The fork keeps independent synthetic evidence and all parent log identities. This summary preserves the audit objective and original retrieval boundaries. '.repeat(2) })
  await child.processPending({ session: fork }, transaction(fork, adapter))
  assert.equal(child.status(fork).blocks.length, status.blocks.length + 1)
  assert.equal(JSON.stringify(session.snapshotEvents()), before)
  return { coldReplay: true, checkpointMapping: true, legacyRefs: true,
    originalRetrieval: true, ccrRetrieval: true, crossSessionRejected: true,
    missingAckRecovered: true, unfinishedRejected: true, readOnly: true, forkIsolated: true }
}

export async function probeTieredAdapter(adapter, { Session, SessionId, appendPluginRecord }) {
  const session = Session.create(SessionId('m0-tiered-bridge'))
  const originals = []
  for (let i = 0; i < 12; i++) {
    const text = ('Synthetic tiered source ' + i + ': keep exact provenance and all original evidence. ').repeat(14)
    session.append('user/message', { id: 'tiered-' + i, role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text }] }, { surfaceOp: 'append' })
    originals.push(text)
  }
  const runtime = new adapter.AcpRuntime({ appendRecord: appendPluginRecord, flushIntent: async () => true })
  const fold = async (startRef, endRef, tier) => {
    const proposal = runtime.propose(session, { startRef, endRef,
      summary: 'This synthetic tiered summary preserves exact source provenance, safe native checkpoint boundaries and the user objective. Original evidence stays recoverable from DSH Session events. '.repeat(2) })
    assert.equal(proposal.tier, tier)
    await runtime.processPending({ session }, transaction(session, adapter))
    return proposal.block
  }
  const t1 = []
  for (let i = 0; i < 4; i++) {
    const refs = runtime.status(session).refs
    t1.push(await fold(refs[0].ref, refs[1].ref, 1))
  }
  const t2 = [await fold(t1[0], t1[1], 2), await fold(t1[2], t1[3], 2)]
  const t3 = await fold(t2[0], t2[1], 3)
  const cold = Session.create(session.id, structuredClone(session.snapshotEvents()), structuredClone(session.header))
  const coldLog = JSON.stringify(cold.snapshotEvents())
  const restored = new adapter.AcpRuntime({ appendRecord: appendPluginRecord })
  assert.deepEqual(restored.status(cold).blocks.map(b => ({ id: b.id, tier: b.tier })), [{ id: t3, tier: 3 }])
  const refs = restored.retrieve(cold, { blockId: t3 }).sources
  assert.equal(refs.length, 8)
  refs.forEach((source, index) => assert.equal(restored.retrieve(cold,
    { blockId: t3, ref: source.ref, limit: 8192 }).text, originals[index]))
  assert.throws(() => restored.propose(cold, { startRef: 'm9999999', endRef: 'm9999998',
    summary: 'An invalid reference range must never be treated as an existing source interval. '.repeat(2) }), /visible span/)
  assert.equal(JSON.stringify(cold.snapshotEvents()), coldLog)
  return { tiers: [1, 2, 3], activeBlock: t3, originalCount: refs.length, coldReplay: true, invalidRangeRejected: true }
}
