# Native upstream migration: implementation and acceptance

This is the implementation ledger for the [M0-M5 plan](context-manager-upstream-first-plan.md).
Implementation, offline tests, exact-commit image CI, provider experiments and
production rollout are distinct acceptance states. ACP and CCR remain disabled
by default; the single Standard preset laboratory gate remains in force.

## M1: pinned Kernel distribution and native port

The unpublished `billion-context@bc4a3f87e2dc98e82df6f707d362e75492fdf3d1`
Kernel is distributed as `0.0.147-dsh.bc4a3f87.1`, not as an npm release.
`vendor/provenance.json` records all output hashes, source tree and lockfile
hashes, full licenses, and two build patches: TypeScript resolves the
`acp-kernel` self import through `./src/index.ts`, and tsup uses named entries
to avoid nondeterministic asynchronous glob ordering. No runtime algorithm changes
are made. The independent M0 runner continues to report the unmodified build
failure; it does not grant production readiness.

`node ci/acp-kernel-audit/build-native.mjs --check` fetches and checks every
upstream Kernel blob, installs the upstream dependency lock without lifecycle
scripts, runs two clean builds, compares every output byte and the committed
tarball, and checks legacy/T1/T2/T3 native-Session replay. The runtime plugin has
its own lockfile and installs the checked-in tarball with `npm ci`.

The adapter delegates argument parsing and boundary resolution to Kernel. DSH
retains exact native range validation, the last two visible messages, durable
intent/ACK transactions, and checkpoint mapping. Single tool-call metadata and
tool-result call identities are projected to Kernel. Media, instructions and
multi-call message envelopes remain protected until their complete projection
and restoration contracts have dedicated acceptance. A range that Kernel
partially excludes cannot compact a larger native interval.

Removed image-processing exports are unused: the host protects media instead of
attempting lossy image conversion. The adapter explicitly retains its existing
two-message recent boundary; upstream's changed default of three is not silently
applied. Old records remain version 1 and are read without rewriting logs.

Local validation: ten targeted checks pass against the baseline and the pinned
distribution, including the frozen legacy log, T1/T2/T3, missing ACK, seeded
fork, original paging, invalid ranges, media refusal and artifact integrity.
Exact-commit hosted CI and native image acceptance must be recorded separately.

Rollback: revert the M1 dependency/lockfile and adapter commit, rebuild the image,
and keep flags disabled. The frozen 0.0.101 fixture remains unchanged. No proxy,
fetch patch or second session storage is introduced. Kernel wire/persist exports
are present in its original distribution but are never imported by the adapter.

## M2: CCR, ContentStorePort and optional reductions

`storeLargeResults` owns thresholding, tool exclusions, classification and
preview selection. `ContentStorePort` appends version 2 original blocks into the
same native Session; `applyRetrieve` and upstream content hashes validate reads.
New canonical refs are `dshccr:v2:<session-scope>:<event-seq>`. The only placeholder
shim substitutes this host namespace for Kernel's reserved `mN` namespace.
Version 1 `ccr:SEQ` remains readable, including in the frozen pre-upgrade fixture.
`retrieve`, `acp_retrieve` and `acp_ccr_retrieve` share the bounded native reader.

No shortened result escapes before a successful native flush. A retry of the
same call and bytes reuses its event/ref and rechecks durability; a changed
payload under the same call id is preserved unchanged. A missing writer, disk
error, cancellation, mixed media, PTC parent, oversized original or exhausted
32 MiB Session CCR budget preserves the complete result. Individual records
retain the existing 768 KiB ceiling. Originals are not independently evicted:
whole-Session archival/deletion controls their lifecycle, so compaction and
repeated retrieval cannot invalidate a ref. Child agents use their own Session;
seeded native forks may read only records inherited into their own log.

Optional `DSH_CONTEXT_MANAGER_CCR_PROJECTION=truncate|crush` uses upstream
`truncateLargeToolOutputs` / `applyCrushToMessages` after storing the exact original,
and always retains a retrieval pointer. Default projection is `retrieve`.
`DSH_CONTEXT_MANAGER_ABSORB_ACTIVE=1` registers `absorb`: `applyAbsorb` validates
the model's decision, and DSH compiles the complete unambiguous pair into its
existing deferred compactRegion transaction. No second hide-state is persisted.
Both capabilities still require the existing ACP/CCR laboratory owner gates.

Fifteen targeted local checks pass across the baseline and pinned distribution,
including both reduction projections, native-pair absorb, canonical references,
colliding sequence isolation, retry idempotency and fail-open storage faults.
The image test also calls all three retrieval aliases through real ToolRuntime.
Hosted image results remain a separate acceptance state.

Rollback: disable optional flags, CCR and ACP, rebuild and keep native logs.
Version 2 CCR is additive; older plugin images do not understand its new refs.
Complete CCR ref access after an image downgrade therefore requires retaining
this small versioned reader (or upgrading again). Original bytes remain in the
ignorable native plugin records; no old log is rewritten or deleted.

## M3: upstream prompts, Nudge and search

`acp-prompts.mjs` resolves the built-in upstream default pack and quality rules.
Only host-surface sections explain DSH refs, deferred native transactions and
bounded retrieval; proxy/XML/inline-restore claims are replaced with the actual
host contract. Nudge text comes directly from `renderNudgeText`. Tool names
`compress`, `search_context` and `decompress` are native compatibility entries;
the existing `acp_*` names remain available. The upstream compress parameter
union maps to DSH's lossless JSON schema and is parsed only by Kernel.

Canonical compress prevalidates up to eight disjoint ranges. Every range uses a
separate durable native transaction, and later ranges are revalidated after
earlier commits. This is deliberately not an all-or-nothing batch: a fault can
leave earlier ranges committed and independently recoverable. Inspect acp_status
afterward; never infer a commit from the queued response alone.

The active Kernel view now receives full native text rather than a 1600-character
preview. Pressure uses a full visible-text token estimate and the resolved native
route's context window, with a disclosed 200000 fallback when unavailable. Media
remains protected; this estimate does not claim provider image-token accuracy.
Projection/Nudge caches key on surface generation and route, so repeated status
reads cannot consume growth cadence or needlessly rewrite the same prompt.

Search uses upstream `blockDocs` and `searchBlocks` with registered hybrid, BM25,
fuzzy or substring algorithms, their actual scores and their default threshold.
The independent exact-match fallback has been removed. Only active blocks from
the caller's Session are supplied to the search engine.

Eighteen local targeted checks pass, including batch cold replay, overlapping
range refusal, byte-identical Nudge, stable repeated reads, short English/Chinese
queries and score parity for all four built-in algorithms. The image tests cover
canonical schema execution through DSH ToolRuntime. Hosted image acceptance is
tracked separately. Rollback is the independent M3 commit; logs are unchanged.

## M4: native cache ledger and measurement coverage

`cache-ledger.mjs` normalizes explicitly selected DSH, OpenAI Chat, OpenAI
Responses and Anthropic usage schemas. OpenAI inclusive prompt input and
Anthropic separate cache write/read counts cannot be confused. DSH's settled
inclusive total must reconcile with its separate counters when all are present.
Missing, negative, inconsistent or incomplete counters are unknown, never zero
cache hits. Unknown requests and unsettled attempts break sample continuity.

The read-only `acp_cache` tool runs inside the same native Session and returns
upstream `buildCacheReport` / `formatCacheReport` results. Upstream decomposition
and fold economics reconcile the complete-usage ledger exactly. Route, explicit
request series, inherited/live origin and unknown-usage boundaries cannot be
combined into a claimed aggregate hit rate. Only closed native compactions are
folds. Missing prefix estimates, prior usage or following usage stay explicitly
unattributed. Prefix/summary sizes are local text estimates; media is unmeasured.

Native timed streams expose stream span and whether a first token was observed.
Request dispatch is not recorded here, so time-to-first-token remains null.
Reports label relative price weights, estimated economics and `currency:null`;
neither the default weights nor a synthetic adapter establish a provider bill.
No raw messages, tool results or other Session's log are returned.

Twenty-one targeted local checks pass across baseline/candidate compatibility,
four usage schemas, exact ledger identity, unknown coverage, route/series/Fork
boundaries and closed/native fold attribution. The real offline AgentLoop image
test now emits deterministic usage and calls `acp_cache` through ToolRuntime.
Hosted image execution is recorded separately. The required real-provider long
conversation experiment remains pending; this plan authorizes no API charges.

Rollback: disable ACP and rebuild without the M4 tool/module. This observer
does not append events or change persisted records.

## M5: native safety, runtime evidence and rollback

All adapter instances share one processing lease per native in-memory Session.
The lease covers every intent flush, native commit, ACK and range in a batch;
another Session can still progress. The adapter rechecks native replacement
generation, visible bounds and the latest authoritative ACP state record after
awaiting intent durability. Native overflow/pressure retains its own engine
lock and can invalidate a queued ACP proposal. Cancellation also rechecks here.
Tool identities must have one complete unambiguous call/result pair inside the
selected interval. Selected events from an unclosed native step are refused,
including plain output that the native tool-pair check already considers balanced;
the actual native compactRegion still owns tool balance and
transaction validation. There is no replacement native lock or second ledger.

Fault tests cover simultaneous processing, cross-instance proposals, stale state,
surface replacement during flush, cancellation, duplicate intent, missing ACK,
and every partial native transaction prefix. Closed native transactions recover
once; incomplete transactions refuse projection. Fork/legacy/T1/T2/T3 regressions
remain in the same suite. The real packaged engine test additionally refuses a
range ending with an unpaired tool call in an open step. Existing pressure/overflow tests prove that
queuing ACP suppresses only pressure, leaving native overflow recovery available.

Status/settings RPC now includes a read-only rollout report per observed Preset.
Mounted owners/tools are distinguished from unobserved Provider Router, CCR and
usage acceptance. Conditional/broken/truncated inventories cannot qualify the
Standard lab. Reverse/Research/Web Presets remain individually blocked for ACP
activation. The unchanged owner-only history opt-in grants no shared-user
authorization; no principal/resource Remote port is claimed or enabled.

The isolated Standard ACP lab smoke now spools a genuine version 2 CCR record,
flushes it through the native Session Store, switches policy back to Basic,
turns Tiered/ACP/CCR flags explicitly off and recreates the container over the
same disposable volume. The new container cold-inspects the native log and
pages the exact CCR original without activating its Agent. The compaction seed
in this volume smoke is synthetic; real compactRegion/AgentLoop acceptance is
the independent packaged-engine tests, not the synthetic seed. This exercises
flags-off rollback on the candidate image with its additive versioned reader;
it does not claim an older image can resolve version 2 CCR refs without that reader.

Forty-one targeted local checks pass, including history default-off/owner opt-in and
existing activation gates. Hosted image checks exercise the real engine, offline
AgentLoop, container recreation and derived editions separately. No new default
activation, production deployment or image publication is part of these PRs.

Rollback: set ACP/CCR/Tiered active flags to 0, set the saved engine policy to
Basic, retain the Session volume and versioned CCR reader, then recreate the
container. Verify cold original retrieval and the original Basic owner before
resuming a pilot. Reverting M5 code alone is not a substitute for disabling flags.

## Remaining acceptance

The requested delivery scope on 2026-10-21 is code and CI; controlled real-provider
acceptance will be scheduled separately. The PRs remain drafts until review.
No production activation or paid provider experiment is included in this delivery.

Real provider charges, real user-session export, shared history access and
production activation have not been authorized by this plan.

M1-M5 code slices are implemented, but the plan's full M4/M5 completion gates
remain pending controlled real-provider workloads and per-edition/preset router,
usage, CCR and principal/resource authorization evidence. Exact-commit hosted
CI is reported separately from these source/local results. The rollout report
always retains `productionApproved:false` and `sharedHistoryApproved:false`.

## Credits

The algorithms are from [billion-context](https://github.com/ranxianglei/billion-context)
and [acp-kernel](https://github.com/ranxianglei/acp-kernel), by ranxianglei.
The full upstream Kernel and project licenses, including additional
product-surface attribution terms, accompany the vendored distribution.
