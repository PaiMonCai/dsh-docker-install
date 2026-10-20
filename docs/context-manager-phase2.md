# DSH Context Manager — Phase 2: durable Web configuration

## What is available now
- Native **Settings → 上下文管理** page, enabled in the Standard and Reverse
  Web images by default. Set `DSH_CONTEXT_MANAGER_PROBE=false` to opt out.
- Persisted settings at `$DSH_HOME/dsh-docker/context-manager/settings.json`.
  The file is inside the existing DSH_HOME volume and is included when that
  volume is backed up. No API secrets or session transcripts are stored.
- Three goal states: basic DSH compaction, tiered ACP-style (planned), off
  (planned). All three are **configuration intentions**, NOT a live engine
  switch. Current DSH/billion-context ownership remains untouched.
- DSH basic fields: `thresholdRatio` 0.40–0.90, `retainRatio` 0.05–0.40
  (< thresholdRatio), `headroomTokens` 0–262144, `auto`.
  Presets: token-saving (65%, 10%), balanced (75%, 20%), preserve-more
  (85%, 25%); headroom defaults to 65,536.
- ACP-style desired fields: growth interval, recent-message and token
  protection, tiering and retrieval flags. T1/T2/T3 and original-text
  retrieval are not implemented in this phase.
- Agent ID overrides and exact provider/model overrides, prioritized
  global → Agent → model. Per-scope entries may override the engine and
  selected native basic ratio fields. This is a **saved policy table**, not
  yet injected into a running Agent preset.
- Runtime panel shows counts from DSH's official
  `agentPresets.compositionInventory()`, compaction event counters, and
  distinctly labels effective engine `upstream-unmanaged`.
- Model context budget preview uses the upstream formula:
  `thresholdTokens = max(0, floor(min(W * thresholdRatio, W - reservedOutput - headroomTokens)))`
  and `retainedRecentTokens = floor((W - reservedOutput) * retainRatio)`.
  Window/output are manually entered for preview. Values are estimates,
  not actual routed model metadata, and the preview does not measure final
  compression ratio.

## API (authenticated native Connection)
The plugin keeps its `/dsh-docker-context-manager` RPC channel:
- `status`: original Phase-1 metadata-only diagnostics
- `settings`: saved policy, optimistic-concurrency revision, official
  preset inventory, event counters, explicit **not applied** runtime status
- `save`: strict schema-v2 validation, revision/CAS, atomic persisted save
- `resolve`: the **desired** global → Agent → model policy for a supplied
  target; the computed result is not a running policy
- `preview`: native pressure/retention budget estimates

`save` requires the exact revision returned by `settings`. Concurrent
pages cannot silently overwrite each other. Invalid/unsafe files fail closed,
without silently resetting any existing configuration. On startup the plugin
observes the saved revision, but it never claims a live engine accepted it.
Even after restart, `runtime.applied=false` until a separate owner-aware
integration passes its runtime gate. Restart alone cannot apply these
parameters in this phase.

Settings files use mode 0600, no-follow bounded reads, symlink/path checks,
atomic rename, fsync and a 32KiB maximum. Validation forbids unknown keys,
duplicates, dangerous IDs, and incorrect number types.

## Deliberately deferred: hard runtime gates
This phase **does not** enable/disable `ctx.compaction` or edit preset-local
compaction configurations. Two external dependencies remain to be verified:
1. PR #121 is separate and remains unmerged: its global host fallback is not
   the same thing as a safe per-preset engine replacement.
2. billion-context may intercept compaction independently of a preset row.
   A detected plugin name cannot certify compression ownership or freedom
   from duplicate listeners.

Before any `runtime.applied=true`, run disposable-session tests for
`/compact`, event pairing, model gateway/bili coexistence, real Agent
override application, and reload/rollback. Do not ship a silent global
`compaction-basic` re-enable as a substitute for these gates.

## Testing and rollback
`node --test tests/test-context-manager-phase1.mjs tests/test-context-manager-phase2.mjs`
is part of Standard + Reverse CI, plus docker syntax and actual Web/runtime
preset smoke. Change settings through Web and recreate the container to verify
persistence, not engine activation. To disable the UI set
`DSH_CONTEXT_MANAGER_PROBE=false`; the persisted settings remain intact.

See [Phase 1](context-manager-phase1.md) and
[PR #121](https://github.com/PaiMonCai/dsh-docker-install/pull/121).
