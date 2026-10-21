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

## Remaining acceptance

M2-M5 implementation and validation will be appended as their slices land.
Real provider charges, real user-session export, shared history access and
production activation have not been authorized by this plan.

## Credits

The algorithms are from [billion-context](https://github.com/ranxianglei/billion-context)
and [acp-kernel](https://github.com/ranxianglei/acp-kernel), by ranxianglei.
The full upstream Kernel and project licenses, including additional
product-surface attribution terms, accompany the vendored distribution.
