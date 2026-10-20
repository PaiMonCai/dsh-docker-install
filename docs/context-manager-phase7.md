# Context Manager — Phase 7: native transaction and failure safety

This batch adds an offline model-adapter integration test which actually calls
`TieredCompactionEngine.compactNow()` on a **real, installed DSH Session,
TokenMeter, SessionStore, LlmRuntime and CompactionEngine**. The adapter's
responses are deterministic and use no paid model credentials or network proxy.

## Acceptance scope
1. Seed a native Session with several completed turns and long content.
2. Call `compactNow()` through the actual native engine (not a fake compact
   service) and a deterministic DSH LLM adapter. Verify that the real
   compaction/start → summary → checkpoint replacement → end transaction
   commits and the metadata can be reconstructed by the history index.
3. Ensure historical Session event records remain available for recovery.
4. Repeat with invalid summary output and adapter transport failure.
   Both must fail closed with a matched compaction/start and failed
   compaction/end, **no successful summary**, and an unchanged visible surface.
5. Verify Phase-6 manual `/compact` handler binding test and isolated Cordis
   single-tiered-owner Standard preset loading still pass; the Reverse and
   Research builds remain unchanged.
6. Reject known competing billion-context/bili profiles in the isolated
   pilot preflight; default Web and all user Sessions remain untouched.

## What is *not* proven
The new test verifies the real DSH native compaction transaction and Tiered
summarizer against a controlled mock adapter, but it does **not** run an
externally hosted frontier model, measure long-session semantic correctness,
assure API billing totals, or certify all transport/proxy paths. The
`DSH_CONTEXT_MANAGER_TIERED_ACTIVE` pilot remains **default-off** and
operator gated, and `runtime.applied=false` remains conservative.

Full production admission requires test credentials explicitly provided in a
disposable environment, prolonged A/B measurements and multi-preset owner
verification. Do not silently use an actual user provider API key in CI.
