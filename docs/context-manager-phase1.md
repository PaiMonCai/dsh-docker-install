# DSH Context Manager — Phase 1 compatibility probe

This phase introduces a **read-only** image-owned Cordis plugin at
`/opt/dsh/plugins/dsh-context-manager`. It does **not** implement T1/T2/T3,
enable another compaction service, change Session surfaces, or perform LLM calls.

## Enable on a test instance

Set `DSH_CONTEXT_MANAGER_PROBE=true` for a Web container and restart it.
The default is **false** while compatibility is being evaluated. The Standard
and Reverse images share the plugin through their common base Dockerfile.

Open DSH Web → Settings → **上下文管理（检测）** to see metadata-only diagnostics.
If the Agent-preset config hook ran *before* this plugin loaded, the panel
reports `preset-overlay-not-observed`; no coverage is inferred. The service
probe can only see the host context; it cannot certify per-Agent scopes.

The RPC command is `/dsh-docker-context-manager` / `status`; writes are rejected.
No conversation content, session IDs, tool arguments, API credentials or user
prompts are collected or returned. Event counters include only the known
`compaction/*` event types. Only the last 12 sanitized preset observations
are retained in process memory. Nothing persists to the DSH_HOME volume.

## Verified source contracts and unverified runtime questions

Upstream DSH exposes `CompactionEngine` with `compactIfNeeded`,
`compactNow`, and `compactRegion`, plus official
`compaction/start`, `compaction/summary`, `compaction/end` and
`compaction/prune` events. Official `BasicCompactionEngine` subscribes to
`agent/pre-step`, `agent/request-error`, `agent/status` and `session/event`.
The `command-compact` package depends on the `compaction` service.

The Phase 1 tests validate the probe's **non-mutating** behavior, bounded
telemetry, plugin wiring and container build-time `--dump-config` recognition.
They do NOT prove replacement of a running Agent preset's compaction engine.
Before Phase 2, perform real image smoke tests for both Standard and Reverse:
1. Enable the probe, launch a Standard agent and both Reverse presets, refresh
   Settings, verify each preset resolves and which scoped compaction plugin owns it.
2. Run an ordinary turn and a manual `/compact` on a disposable session;
   check Session log sequence and event counters. Do not test on valuable history.
3. Check DSH + external billion-context combinations: ensure a single owner.
   `billion-context` presence in config is **not** proof of active ownership.
4. Confirm the phase-2 engine can replace the official service **inside each
   Agent context**, without double `agent/pre-step` listeners and while keeping
   `command-compact` bound to the selected engine.

Do not enable a custom backend or merge its competing listeners before these
checks. PR #121's host-level fallback is separate and is deliberately unchanged
here. Backups of the future config and tiered storage are deferred to later phases.

## Source references

- [DSH compaction service](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/compaction/compaction/src/index.ts)
- [DSH basic backend](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/compaction/compaction-basic/src/index.ts)
- [billion-context DSH disable overlay](https://github.com/ranxianglei/billion-context/blob/master/src/agent/dsh-compaction-disable.ts)
- [ACP kernel](https://github.com/ranxianglei/billion-context/tree/master/kernel)
