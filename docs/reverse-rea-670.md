# Reverse REA 6.7.0 upgrade

## Upstream snapshot

Checked on 2026-10-24 (Asia/Shanghai): the npm `rea-agents` latest tag resolves
to **6.7.0**, published at `2026-10-18T08:12:05.640Z`. The official
[`rea-agents-6.7.0` release](https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0)
points to `27dc42d10249f0410904a75c0997842eb03b931c`.

The registry records this tarball integrity:

```text
sha512-yhIx2ioJYYT1C/tONfYeitC6LhnKmCh+ZwRUOgYuhSc733lGhkkt73zhug9WmLgxoMdKuqIYGCoBfD4fXkOhFw==
```

The observed upstream main commit was
`3e7e102a518b9112a2a8aa0590ae6f6951fd0635` (2026-10-24 01:00:14 +08:00),
898 commits beyond the release. Its recent Rust compressed-section admission
fix is unreleased. Main retaining the same package version is not evidence that
its changes are in the npm tarball. This image pins the published 6.7.0 package;
it does not install upstream main or silently update REA at startup.

## Upgrade from 6.4.0

- 6.5 changes MCP discovery: use `tools/list`, grouped tool availability and
  provider capabilities, rather than `server_identity.catalog.tools`.
- 6.6 was tagged but not published to npm; 6.7 includes its changes. These include
  retained JavaScript analysis views, multiple APK resource locales, optional
  caller-installed Kuna support, and provider startup/cancellation fixes.
- 6.7 corrects edits to duplicate JSON/JSONC client configuration members.
  Our image continues to launch `rea mcp` directly through the existing native
  DSH preset; it does not run REA setup or modify the user's MCP configuration.
- The supported Node range remains `^22.19.0 || ^24.11.0 || >=26.0.0`.
  The existing image's Node 24 runtime satisfies it.
- Ghidra 12.1.4, JADX 1.5.3 and the checksum-pinned JADX headless MCP 0.7.1 JAR
  remain fixed. New optional providers are not automatically installed.

## Data and result compatibility

Upstream 6.6 introduces breaking Evidence/snapshot commitments: explicit nullable
`relationship_coverage`, scoped inventory coverage and `integrity_contradictions`
replace older inferred coverage. Upstream does not migrate saved files. Retain
old originals and regenerate Evidence/snapshots with the new release when they
must be consumed by REA; image startup does not rewrite or delete them.

Other changes include nullable attachment/address fields, a `{ graph, limitations }`
call-graph result, decimal-string Android version codes, and typed native-UI errors
with `partial_observation`. Consumers must preserve unknown/null and partial facts.
Our `dsh-reverse-evidence/v1` reports are a separate project format; they are not
claimed to be migrated REA Evidence. Existing report-reader and queue behavior
continue to be validated by their own regression checks.

## Verification

`reverse/rea-smoke.mjs` starts the actual installed `rea mcp` process with the same
compact schema profile as the DSH preset. It checks initialization/version,
paginated `tools/list`, every compact input-schema byte budget and required tools.
It then statically analyzes a generated JavaScript fixture containing a top-level
throw, validates the Evidence/summary, removes the fixture, and reads the retained
summary with `inspect_analysis_view`. It invokes no model or live analysis target.

The Reverse Dockerfile runs this gate for both build platforms. Existing image
CI separately checks installed engines, inherited Standard plugins, native Session
cold replay, context-plugin lifecycle, and authenticated Web/Chromium behavior.
ARM64 build checks use QEMU and are not physical ARM64-host evidence.

Local checks and hosted CI conclusions are recorded in the upgrade PR. A pushed
Git release tag starts image publication; the tag alone does not establish that
all edition images have finished publishing.
