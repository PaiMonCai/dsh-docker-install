# Context Manager M0 audit

This is an isolated audit harness, not a production dependency workspace.
The production plugin remains on `acp-kernel@0.0.101`.

## Reproduce

Requirements: Node 24.14.1, npm, GitHub CLI authenticated for public repository
reads, `tar`, and network access to the npm registry and GitHub API. No model
credentials, Docker daemon, real sessions, or provider charges are required.

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix ci/acp-kernel-audit
node ci/acp-kernel-audit/run.mjs
```

The runner creates fresh build directories under the ignored
`ci/acp-kernel-audit/node_modules/.cache/`. It verifies the baseline tarball SRI,
checks that installed baseline files match that tarball, reads `npm view`,
verifies all upstream Kernel blobs against the pinned Git tree, and validates
the package/lockfile/license SHA-256 checksums in `snapshot.json`.
It installs the upstream build dependencies with the upstream lockfile and
`--ignore-scripts`, then invokes the unchanged upstream clean build.

It collects actual ESM exports, TypeScript declaration diffs, default config
and initial-state diffs, T1/T2/T3 bridge parity, old-log replay, and the full
upstream Kernel test suite. Type generation failing does not authorize use of
the emitted JavaScript. Diagnostics are retained without patching the source.

The runner exits nonzero for collection/integrity/legacy regression errors.
The currently known upstream clean-build failure is recorded as an **upgrade
blocker**, while successful evidence collection exits zero. Consumers checking
upgrade readiness must read `decision.upgradeAllowed`; the additional
`--require-upgrade-ready` option returns nonzero while the upgrade is blocked.
There is deliberately no automatic path that approves a production upgrade.

## Evidence

`node_modules/.cache/m0-output/` contains:

- `registry.json` and `registry-npm-view.log`: live registry observation and
  exact published-package metadata; timestamps may differ from the frozen audit.
- `api-baseline.json`, `api-candidate.json`, `api-diff.json`: actual runtime
  exports and normalized declarations, including full before/after text.
- `source-build.log`: complete unmodified clean-build result, even when failing.
- `source-build-dependencies.json`: upstream lockfile package/version/integrity/
  license inventory, including optional and platform-specific build dependencies.
- `legacy-regression.log`, `upstream-tests.log`, `evidence.json`: test results,
  provenance, compiled-file inventory, and a separate upgrade decision.
- `baseline-package.tgz`, full license texts and `diagnostic-only/`: the verified
  published baseline and explicitly non-release candidate build output.

The dedicated Actions workflow uploads these artifacts on Ubuntu and Windows.
A green audit job means evidence was collected; it does not mean the candidate
built cleanly or is suitable for production. The normal Standard image workflow
also consumes the frozen fixture through its installed DSH Session and Kernel.

`evidence.json` in this directory is a checked-in **Windows local observation**.
Regenerate it deliberately with `node ci/acp-kernel-audit/run.mjs --record` after
reviewing a snapshot change. CI writes fresh artifacts without editing this file.
It is not evidence of CI for later commits.

## Legacy fixture

`tests/fixtures/context-manager/acp-0.0.101-session.json` is synthetic data created
using the real DSH Session `0.2.1-rc.2` and published Kernel `0.0.101`. It includes
sparse event sequence numbers, two T1 blocks merged into a T2 block, durable
intent/state events, checkpoint mappings, and a `ccr:0` original. The transaction
is the controlled native-event double used by the bridge tests, not the real
CompactionEngine. Replay checks never overwrite the source fixture or logs.

The separate fresh-session probe checks four T1 folds, two T2 folds and one T3
fold, exact original retrieval, cold replay, and rejection of unknown ranges.
These are semantic bridge checks, not provider quality or billing measurements.

To replace the golden fixture intentionally:

```sh
node ci/acp-kernel-audit/generate-fixture.mjs --write
```

Review the fixture, then update `legacyFixtureSha256` in `snapshot.json`. Normal
audit/test runs never regenerate it. New state formats require another versioned
fixture; do not replace this pre-upgrade sample to make an upgrade pass.

## Attribution

The Context Manager uses [acp-kernel](https://github.com/ranxianglei/acp-kernel)
from [billion-context](https://github.com/ranxianglei/billion-context), by
ranxianglei. Preserve the full license files in this directory, including their
additional product-surface attribution terms. Package metadata saying `MIT`
does not replace those full texts. No HTTP proxy, MITM or fetch interception
implementation is included in the DSH runtime by this audit.
