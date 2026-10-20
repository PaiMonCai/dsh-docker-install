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

A versioned native `acp-intent` Plugin Record is now appended and
`ctx.sessions.flush(session)` must confirm a durability listener BEFORE the
native compaction transaction begins. On restart, the adapter reads the intent
and the native append-only log, validates a **completed** start/summary/
checkpoint/end transaction with matching summary and source-range provenance,
and reconstructs the ACP state without mutating cold Session history.
Failed/uncommitted intents are ignored; unfinished or conflicting native
transactions quarantine recovery rather than guessing. The Docker image
executes crash-injection and failed-intent replay cases. This is one-step
recovery, not a claim of full multi-owner/multi-block crash linearizability.


Native ACP intent + native checkpoint recovery handles the single-transaction
crash window. Multi-intent concurrent stress, Fork with partial/seeded logs and
all storage failure scenarios still require production-level verification.
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

## CI experimental preset loading

The PR-only `test-context-manager-acp-lab.sh` runs in a newly allocated
Docker volume, deliberately enables `DSH_CONTEXT_MANAGER_ACP_ACTIVE=1`, and
uses the existing disposable Session replay smoke to mount Standard without
an external model call. The Context Manager ready marker requires **active**
Tiered and ACP Fiber counts and a mounted Standard preset, not just YAML
configuration presence. This is a boot/ownership test, not proof of model
calling the four tools correctly across multiple Agent steps.

## Automatic pressure and overflow recovery (upstream DSH)

ACP experimental Standard sets `auto:true` on the one native Tiered
BasicCompactionEngine. That **restores** DSH's upstream pre-step
pressure handling, context-overflow retry accounting and optional
ToolResultPruner. When a model ACP proposal is queued, the subclass skips
**only** the pressure pass for that one Session, allowing the ACP adapter
to commit at its next `agent/pre-step`. Native overflow recovery is NEVER
skipped. Pending state is per-Session and cleared after success/error.
Model-driven compression is not claimed to replace automatic fallback.

## Multi-generation hierarchical regression

The `test-context-manager-acp-t3.mjs` image test folds four independently
completed T1 blocks into two T2 blocks and finally one T3 block. Each
layer commits through the session event-log transaction double, then
replays from a cold Session and checks that deep source retrieval still
reaches the original text. The real DSH compaction engine is separately
exercised in `test-context-manager-acp-real-region.mjs`.

## Actual DSH model-tool execution pipeline

`test-context-manager-acp-tools.mjs` runs the installed DSH ToolRuntime's
schema, parameter validation, call dispatch and canonical output stages
for the four ACP tools. It checks safe queuing, invalid-ref rejection,
single-proposal ownership and no early Session Surface mutation. The
upstream full AgentLoop transport across tool results and model streams
is a separate production acceptance item.

## Adaptive model guidance

ACP contributes a bounded content-free advisory message via the native
`ctx.systemPrompt.context()` dynamic runtime-context slot. The kernel
selects a recommended tier and the model decides whether to compress.
The generated text is stable across initial assembly and prompt refresh for
a single DSH Surface content generation and never contains raw user or tool
content. DSH's single-engine automatic pressure and overflow recovery remains
authoritative. This guidance is not a substitute for real model validation.

## Lossless original paging (not CCR offload)

`acp_retrieve` lists source refs from an active block, then pages through
the **actual original DSH Session event text** by ref and character offset,
with a hard 8192-character return cap. It rejects refs not covered by that
block. Unlike `acp_decompress`'s short preview, retrieval does not shorten
the source before pagination. This is a safe event-backed read path; it does
**not** implement billion's arrival-time CCR tool-output offload.

## Full offline AgentLoop acceptance

`test-context-manager-acp-agent-loop.mjs` mounts the installed DSH
AgentLoop, SessionStore, ToolRuntime, SystemPrompt and a deterministic
LlmAdapter. It drives the full model/tool/retry handoff, calls four ACP
tools and confirms the native compaction checkpoint and source preservation.
It uses no paid provider or external proxy. Real provider performance,
context-cache behavior and multiuser release security remain unvalidated.

## Native CCR: arrival-time tool result offload (opt-in)

The ACP Standard lab may additionally set `DSH_CONTEXT_MANAGER_CCR_ACTIVE=1`.
At DSH `tools/post-execute`, plain-text tool responses of >=16000 characters
are copied to a bounded, ignorable native `ccr-result` Session Plugin Record.
**Only after `ctx.sessions.flush(session)` reports a durable writer** can the
normal tool result be replaced by a short `ccr:SEQ` locator + preview. The
model may call `acp_ccr_retrieve` to read the exact original text by page in
its own Session. A failed persistence, non-text response, oversized payload,
nested PTC call, or failed tool execution returns the full original tool
result unchanged. This protects durable provenance and avoids intercepting
HTTP or using another store. Real PTC subcall result-log offload is not included.

This is an **explicit additional laboratory flag**. It is not enabled for
ordinary Agent sessions and is not authorization for shared/tenant history.

## Honest runtime UI status

The `status` and `settings` Web RPC responses now include an
`experimentalRuntime` object derived from **active** mounted Cordis Fiber
states for the Standard preset, not from flags alone. A mounted Standard
Tiered+ACP lab may report `experimentalRuntime.active=true` while
`runtime.applied=false` and `productionApproved=false` remain unchanged.
This is deliberate: no host-global proof or tenant authorization has yet
been established.

## Reproducible offline benchmark

The Docker build executes `test-context-manager-acp-benchmark.mjs` against 36
synthetic source messages, three native-event compaction transactions and a
cold replay. It emits a JSON line containing model-visible token **estimates**,
reduction percentage, Session projection P95, elapsed time and current heap.
This does **not** measure API billing, LLM summary quality, real model context
window adaptation, prefix-cache reuse, real model latency or user-visible
multi-tenant memory bounds. Real-provider benchmarks require operator-supplied
credentials and an explicit spending/privacy authorization before release.
