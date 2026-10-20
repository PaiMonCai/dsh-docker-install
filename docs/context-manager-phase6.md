# Context Manager — Phase 6 native owner takeover pilot

## What is shipped

The normal DSH Docker install continues to use the original native DSH
compaction services. Web settings edits alone **do not** activate tiered
compaction. All default startup paths remain unchanged.

This batch introduces an **isolated, explicit startup pilot for Standard
only**. It replaces the existing @deepseek-ai/dsh-compaction-basic row inside
the DSH `standard` Agent preset **one-for-one** with the native
`TieredCompactionEngine` subclass, retaining its original row ID, parameters,
and @deepseek-ai/dsh-command-compact sibling. DSH still owns the
`ctx.compaction` singleton, lock, surface pairing, failed-transaction log,
retry and summary persistence. No extra `compaction` service is inserted.

Native preset initialization must wait for
`dshContextTieredPolicy` registered by Context Manager's
`internal/config` overlay. The dedicated
`cordis.tiered-lab.patch.yml` is **not** part of the default patch path.

### Strict pilot-only enablement
Only on a throwaway single-owner installation with NO `billion-context`
bundles, gateway routing or competing compactor:

1. Set saved Context Manager global engine to **分层压缩** (desired setting).
2. Set all of:
   ```
   DSH_CONTEXT_MANAGER_TIERED_ACTIVE=1
   DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=1
   DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY=1
   ```
3. Recreate the container and inspect its preset composition and
   `/compact` on a **disposable** idle Standard session. Never use
   this lab pilot on a valuable conversation or shared production server.
4. To rollback, unset the three vars and recreate the container; the
   ordinary native Basic backend is mounted again on subsequent boots.
   Session history is not automatically migrated or rewritten.

This is an **operator assertion**, not cryptographic or model-wire proof that
an out-of-process LLM proxy is absent. The preflight rejects known profile
billion-context bundles but cannot detect every external route; hence the
explicit `NO_EXTERNAL_PROXY` assertion.

### Exact scope

- Only preset ID `standard` is eligible.
- Reject duplicate Basic providers, pre-existing Tiered providers, a missing
  native manual `command-compact` entry, or any bili-native/billion-context
  entry inside that preset.
- Model-level `basic`/`off` mode overrides are unsupported for this pilot;
  reject instead of claiming a per-model service replacement.
- Snapshot the saved global + Agent `basic` parameters at boot; settings
  changes require restart to update native thresholds. Tiered summary
  generation checks desired policy on each request, falling back to original
  native `summarize` for a non-tiered desired mode without registering new
  listeners.
- No auto-generated `/compact` request or billed LLM call is performed in
  a real user session by this batch.
- Runtime status continues to mark `applied=false` and
  `ownerVerified=false`. Lab evidence means only that a candidate
  replacement was attempted, not a certified gateway-exclusive takeover.

## What tests prove and what remains

Unit tests verify exactly-one replacement, no duplicate service,
manual command preservation, fail-closed preconditions, disabled defaults,
and backend tier selection from source-tagged DSH checkpoints.

Standard/Reverse CI build the default image and verify there is **no
automatic runtime takeover**. A Docker-only contract check imports the
actual installed upstream `@deepseek-ai/dsh-command-compact` handler and
proves that an explicit `/compact` invocation dispatches to exactly one
supplied `ctx.compaction.compactNow` service. This exercises the true
upstream command binding but uses an **in-memory fake backend**, not a real
LLM-powered summary.

The next promotion gate is a real disposable `standard` Agent with
real native compaction output (including failed summary rollback and
session replay) and evidence that external bili routing is disabled. Without
this, do not use the new pilot in production or claim functional parity
with billion-context.
