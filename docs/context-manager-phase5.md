# DSH Context Manager — Phase 5: real Session replay and ownership gate

## Completed implementation
- A disposable, **real DSH Session** is created through
  `sessionController.create()`. It records native user/message and an isolated,
  synthetic, validly correlated compaction/start → summary → replacement → end
  chain using `Session.append()`; `sessions.flush()` waits for persistent
  storage.
- GitHub CI then DESTROYS the first Docker container, retaining only a
  temporary `DSH_HOME` named volume, starts a completely new container, and
  reads the same Session through `sessionController.inspect()` without
  activating an Agent. It requires one closed native compaction record and
  reads the original source text through the Phase-4 read-only index.
- Both Standard and Reverse workflows run this test on temporary images and
  volumes. The test output carries only ephemeral Session IDs, never raw
  source text, credentials or prompts.
- `ownership-audit.mjs` conservatively reports per-preset active native and
  external plugins, conflict risk and host-only service visibility.
  `safeToActivateTiered=false` remains mandatory even if one native
  compaction plugin is observed. Host and preset scans cannot see every
  gateway interception path.
- No production Sessions are ever modified by these CI paths: the replay
  fixtures activate only when BOTH `DSH_CONTEXT_MANAGER_CI_REPLAY_MODE` and
  `DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM=isolated-test-volume` are present.

## Precisely what this proves — and what it does not
This validates DSH's *actual native persistence and cold replay* across
complete container replacement, including a prebuilt, synthetic compaction
transaction in a disposable Session. The fixture does **not** make a real LLM
summarization request, trigger automatic compression, or execute `/compact`.
Therefore it does not prove that a production TieredCompactionEngine can take
ownership of the compaction service.

The settings API reports the additional conservative `ownerAudit` diagnostics.
It continues to report `runtime.applied=false` and
`effectiveEngine=upstream-unmanaged`; it does not silently enable the
candidate compaction backend.

## Authorization limitations remain
The generic Web Connection RPC authenticates access but does not expose the
Typert per-caller, per-Session principal/resource contract. Phase-4 history
remains **disabled by default** and must not be enabled on shared or
multiuser deployments. `DSH_CONTEXT_MANAGER_HISTORY_READ=owner-only` is an
operator acknowledgment for exclusively single-owner deployments, **not a
technical proof of per-user authorization**. The safe multiuser solution is
a first-party Typert Remote endpoint with session-resource binding; do not
substitute `remoteAccess.allows()` outside a Remote invocation.

## Pending gate for live tiered compaction
Native manual `/compact`, concurrent auto listeners, billing/LLM behavior,
external billion-context coexistence, Agent-scoped owner replacement and
rollback still require isolated end-to-end verification before any actual
runtime engine switch is allowed.
