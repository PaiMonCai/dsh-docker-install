# DSH Context Manager — Native ACP phases 8–11 (isolated workbench)

## Scope and safety

This development line integrates the published MIT `acp-kernel@0.0.101`
directly into the existing DSH Context Manager while keeping DSH's
`CompactionEngine`, event log, replay, original-history provenance,
single-owner guard and model adapter as the only source of truth. No HTTP
proxy is started and normal Web/Reverse/Research startup is unchanged.

**This is a feature branch implementation, not production acceptance for
all phases.** The ACP toolset remains behind the Phase-6 lab take-over
assertions AND a second opt-in flag. Only disposable single-owner
`standard` sessions may be used.

### Experimental activation

In a disposable installation without billion-context, save
`engine=tiered` in Context Manager settings, then set all FOUR:

```sh
DSH_CONTEXT_MANAGER_TIERED_ACTIVE=1
DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=1
DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY=1
DSH_CONTEXT_MANAGER_ACP_ACTIVE=1
```

The preflight rejects known conflicting bili manifests and direct `/bili/`
proxy settings. These flags are **operator assertions, not independent
proof** that all external routes are safe. Do not use shared/multiuser or
valuable sessions. Unset all four and recreate the container to roll back.

## Phase 8 — kernel and identity

- `acp-runtime.mjs`: pure `acp-kernel` projection of DSH current Surface
  with stable event-seq IDs; source user/assistant/tool messages remain in
  immutable DSH history. Never publish kernel-mutated messages as if they
  were DSH's authoritative history.
- `acp-state` is committed only after the actual native compaction
  transaction succeeds, using DSH's ignorable Plugin Record event grammar;
  it survives Session fork, log replay and persistence. No separate full
  transcript or plaintext disk index.
- `summaryOfBlockId` identifies DSH-native replacement checkpoint
  carriers. Existing Phase-4 source retrieval remains available even if
  ACP record restoration fails.

## Phase 9 — model-driven native actions

- `acp_status`: bounded refs/blocks and nudge diagnostics; no prompt text.
- `acp_compress`: model-written summary, checked by ACP kernel, queued for
  DSH `agent/pre-step`. Never edit the Surface inside an unsettled tool call.
- `acp_decompress`: bounded, cache-safe, read-only original-event return.
- `acp_search_context`: search ACP block summaries, no outside service.
- `withAcpSummary` passes the already-written summary to the exact
  subclass `summarize` hook, so `ctx.compaction.compactRegion()` alone
  performs durable start/summary/replace/end and balance validation.
  No extra provider is registered.

## Phase 10 — persistence and recovery

The ACP state record is replay/fork-safe but the actual compaction transaction
and subsequent state record are **not one atomic append**. A crash between
these operations can leave a valid native checkpoint without an ACP block.
This must be detected and repaired or quarantined before promotion.
`acp_decompress` never changes the active context prefix. CCR, lossless
arrival-time tool-result offload, live nudge injection, block-level T2/T3
reconciliation and multi-preset cross-session recovery remain open.

## Phase 11 — production admission gate (NOT CLEARED)

- Do not change `runtime.applied=false` based only on a config overlay.
- Prove active mounted per-Agent service owner, no bili route, and successful
  model-driven compression under actual DSH Agent Loop with paired tools.
- Test real model adapter/API performance and correctness on consented
  disposable sessions; compare token usage, cold replay, prefix cache.
- Prove crash injection between native checkpoint and ACP state commit,
  concurrency, fork, overwrite prevention and explicit rollback.
- Move history-content endpoints to principal/resource-authorized native
  Typert Remote before multiuser availability; generic Connection RPC
  remains disabled for history reads by default.

No claim of billion-context feature or performance parity is made here.
