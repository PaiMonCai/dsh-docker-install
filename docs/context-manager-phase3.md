# Context Manager Phase 3 — Tiered native summarizer

## Delivered
- Original, dependency-light policy and quality logic in `tiered-core.mjs`:
  native-checkpoint-scoped T1→T2→T3 progression; distinct prompts for each
  stage; verified headings, non-empty sections, text-only output and known
  credential-pattern rejection; incremental nudge threshold arithmetic.
- `tiered-backend.mjs` implements a candidate subclass of DSH
  `BasicCompactionEngine`. Its `summarize` method builds a single direct
  one-shot `ctx.llm.stream()` request and returns the shape expected by
  upstream native compaction. It does **not** touch Session log or surface.
  Native `compactNow`/`compactRegion` own selection, tool pairs, shrink
  checking, durable `compaction/start`/`summary`/`end`, and failure rollback.
- `tiered-native.js` resolves the matching installed DSH libraries rather
  than shipping a shadow copy of Cordis. The image performs an import smoke
  without mounting the class.
- Unit tests cover tier progression, resistant-to-spoofing source checks,
  growth decisions, checkpoint structural quality, fail-closed behavior,
  mocked one-shot LLM I/O, and no Session writes.

## Ownership boundary — critical
The tiered implementation is **shipped but NOT installed in any Cordis
composition** in this phase. Creating the class requires an explicit
`DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED=1` test gate, and nothing in the
entrypoint or Settings UI sets that gate. This avoids two backends registering
the same `compaction` service or two `agent/pre-step` handlers.

Why: PR #121 (host fallback) and the built-in preset compaction group have
different scopes; `billion-context` can additionally intercept traffic
outside the preset. The current inventory cannot confirm a unique owner for
a live Agent session. A safe replacement must first be demonstrated on an
actual disposable session, including manual `/compact` events. Standalone
"class constructed" or "config displayed" is not a substitute.

The Settings UI continues to report `runtime.applied=false` and
`effectiveEngine=upstream-unmanaged`. Selecting tiered mode persists
*desired* policy, NOT a live switch. Real T1/T2/T3 checkpoints do not occur
until the native backend is explicitly installed inside the active preset.

## Next integration gate
1. On a disposable live DSH context inspect exact Agent and host service
   ownership; test both with and without the external bili plugin.
2. Replace the preset-owned Basic backend with the Tiered subclass, **not**
   append it in parallel, and verify one provider of `ctx.compaction`, one
   automatic listener, and `command-compact` bound to that owner.
3. Validate successful and failed `/compact` runs and event pair matching,
   model summary correctness and Session replay after restart.
4. Test growth-triggered nudges and recent-content protection against native
   token-meter routing; wire actual model/Agent overrides only after verified.
5. Then and only then expose live engine switching and
   `runtime.applied=true` in Web.

This approach deliberately leaves the deployed behavior unchanged while
making the tiered summarization engine available for integration testing.
