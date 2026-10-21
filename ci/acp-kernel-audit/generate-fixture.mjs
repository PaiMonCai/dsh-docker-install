import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Session, SessionId, appendPluginRecord, baselineRoot, fixturePath,
  loadAdapter, transaction, probeLegacySession } from './compatibility.mjs'

// Explicit maintainer command only: normal tests always consume the frozen file.
assert.equal(process.argv[2], '--write', 'pass --write to replace the synthetic baseline fixture')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-acp-fixture-'))
const clock = Date.now
Date.now = () => Date.parse('2026-10-21T00:00:00Z')
try {
  const adapter = await loadAdapter(baselineRoot, temporary)
  const session = Session.create(SessionId('m0-synthetic-legacy-session'))
  const ccrText = 'SYNTHETIC-CCR-ORIGINAL '.repeat(64)
  const saved = await adapter.offloadCcr({ agent: { session }, name: 'read_audit_fixture', callId: 'm0-tool-1' },
    { content: [{ type: 'text', text: ccrText }], isError: false },
    { appendRecord: appendPluginRecord, flush: async () => true, minChars: 128 })
  for (let i = 0; i < 12; i++) {
    appendPluginRecord(session, 'plugin:dsh-docker-context-manager/m0-gap', { version: 1, marker: i })
    session.append('user/message', { id: 'synthetic-' + i, role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: ('Synthetic source ' + i + ': preserve exact evidence and session ownership. ').repeat(12) }],
    }, { surfaceOp: 'append' })
  }
  const runtime = new adapter.AcpRuntime({ appendRecord: appendPluginRecord, flushIntent: async () => true })
  for (let i = 0; i < 2; i++) {
    const refs = runtime.status(session).refs
    runtime.propose(session, { startRef: refs[0].ref, endRef: refs[3].ref,
      summary: ('Synthetic group ' + i + ' keeps all verified source evidence, stable message references and the DSH event log as the only authoritative history. ').repeat(2) })
    await runtime.processPending({ session }, transaction(session, adapter))
  }
  runtime.propose(session, { startRef: 'b1', endRef: 'b2',
    summary: 'The two synthetic Tier 1 groups retain independent original evidence and stable message references. Their Tier 2 summary preserves every recovery boundary and keeps DSH Session ownership. '.repeat(2) })
  await runtime.processPending({ session }, transaction(session, adapter))
  const status = runtime.status(session)
  const record = adapter.replayAcpState(session)
  const active = status.blocks[0].id
  const originals = runtime.retrieve(session, { blockId: active }).sources.map(source => ({
    ref: source.ref, text: runtime.retrieve(session, { blockId: active, ref: source.ref, limit: 8192 }).text,
  }))
  const fixture = {
    schemaVersion: 1,
    provenance: { synthetic: true, kernel: '0.0.101', dshSession: '0.2.1-rc.2',
      nativeTransaction: 'controlled double; not CompactionEngine acceptance', generator: 'ci/acp-kernel-audit/generate-fixture.mjs --write' },
    header: session.header, events: session.snapshotEvents(),
    expected: { blocks: status.blocks.map(b => ({ id: b.id, tier: b.tier })), activeBlock: active,
      checkpoints: record.checkpoints, refs: record.state.messageRefs.byRaw,
      originals, ccr: { ref: saved.ref, text: ccrText } },
  }
  await probeLegacySession(adapter, fixture)
  await mkdir(dirname(fixturePath), { recursive: true })
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n')
  console.log('Wrote synthetic legacy fixture:', fixturePath)
} finally {
  Date.now = clock
  await rm(temporary, { recursive: true, force: true })
}
