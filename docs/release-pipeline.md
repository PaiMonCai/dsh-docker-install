# Image release pipeline

For image selection and release commands, see [the CI guide](ci.md).
For repository ownership and check entrypoints, see [project layout](project-layout.md).

Standard follows upstream DSH. Research, Research Economics and Reverse consume
the successful Standard artifact; they do not independently install upstream DSH.
Release jobs use Ubuntu 24.04 runners explicitly, so an `ubuntu-latest`
migration cannot silently change their host Python or system tools.

## Release contract

Standard publishes a `linux/amd64` + `linux/arm64` index. Both platform configs
must agree on these labels:

| Label | Meaning |
| --- | --- |
| `io.caicailo.dsh.version` | Installed upstream DSH version |
| `io.caicailo.dsh.edition` | `standard`, `research`, `research-economics`, or `reverse` |
| `io.caicailo.dsh.standard.revision` | Standard source commit |
| `io.caicailo.dsh.source.tree` | Hash of the relevant edition's tracked source |
| `io.caicailo.dsh.channels` | npm channel snapshot taken by Standard; metadata only |
| `io.caicailo.dsh.release.track` | `dev` or `release`, derived from the Git ref |
| `io.caicailo.dsh.release.tag` | Git release tag, such as `v1.2.3`; empty on development images |
| `io.caicailo.dsh.base.digest` | Standard index digest, on derivatives |
| `org.opencontainers.image.revision` | This edition's source commit |

`ci/registry.mjs` reads and verifies index, manifest and config digests. Only the
configured GHCR repository is accepted. Version/source constraints are checked
against the artifact, including agreement between architectures.

## Build and promotion

1. Standard runs its source compatibility and real runtime/browser audits.
2. Multi-platform builds push only `candidate-<edition>-<run>-<attempt>` tags.
3. A separate promotion job validates provenance while holding the shared
   promotion lock. Development candidates must match current main and cannot
   downgrade DSH. Tagged candidates must match the remote `v<SemVer>` Git tag;
   release derivatives require the Standard digest published for that same tag.
4. Main publishes only `dev` / `<edition>-dev` plus a snapshot named
   `dev-<short-sha>-<run>-<attempt>` (with edition prefixes). Git tags publish
   `<project-version>` / `<edition>-<project-version>` and the release floating
   aliases (`latest`, `research`, `research-economics`, `reverse`). Published
   version indices are reused on reruns, never replaced by different contents.
   Older tagged releases cannot move newer floating aliases backwards.
   npm channel aliases are no longer automatically published.
5. Standard independently queues Research and Reverse with the immutable
   `image@sha256:...` reference and Standard provenance.

Accepted Git release tags include prereleases such as `v1.2.3-rc.1` (no build
metadata, at most 90 characters). They use the same release track and may move
floating aliases when their project version is not older; there is no separate
RC alias policy.

Every downstream workflow checks out its own `github.sha`, matching its workflow
definition. Tagged Standard dispatches use that same tag ref; development
dispatches use main. The legacy input name `source_sha` describes **Standard provenance**;
it never selects downstream source.

Downstream preparation resolves the base once. Both Research matrix targets,
Reverse audits, and Reverse publication reuse that exact digest. If main has
unpublished Standard source changes, standalone downstream development builds wait for the
Standard dispatch. PRs changing Standard build a local candidate base instead
of pulling a not-yet-published version tag.

Builds do not share a cancelling workflow lock. Only short promotion jobs are
serialized. Their shared lock uses `queue: max` so pending promotions wait
instead of replacing one another. The updater also queues concurrent requests.

Candidate suffixes are outputs of the producing jobs. Rerunning a failed
promotion reuses the original candidate rather than assuming it was built in
the new run attempt. A failed Research matrix item can be rebuilt while retaining
the other successful item; promotion requires both targets to succeed.

Standard amd64 audits only import the shared release cache; its multi-platform
build exports it afterwards, preserving ARM64 entries between runs. Reverse
builds and runs its complete runtime/browser audits on native Ubuntu 24.04
AMD64 and ARM64 runners, with separate architecture caches. Each runner pushes
its audited architecture candidate; the assembly job creates the combined index
only after both succeed, and the existing promotion contract validates it.
The updater sets `skip_dispatch: true`; other triggers dispatch by default,
including push events where workflow inputs are absent.

## Automatic updates and recovery

`Check dsh Updates (Development)` runs daily and can also be dispatched on main.
It only reads and publishes development image aliases; releases require an existing
versioned Git tag. Default installed instances continue following release aliases.

- It checks the published `dev` Standard contract even when npm and Dockerfile versions
  are equal. Missing artifacts, legacy images without the contract, or changed
  Standard source request a new build.
- The version-record commit happens after successful Standard promotion.
  Failure before promotion cannot advance the source version.
- If the image published but the version-record commit failed, the next check
  reuses that artifact and retries the commit.
- Reconciliation compares both Research targets and Reverse with Standard's
  digest and current edition source. It queues only incomplete or outdated
  editions, without rebuilding a healthy Standard image.
- Dispatch retries are independent. A dispatch outage does not undo a published
  Standard artifact; a warning is recorded. Daily reconciliation retries dev
  dispatches. Tagged releases retry on the original tag by rerunning the failed job.

The Standard source hash normalizes only the recorded DSH version in Dockerfile
and Compose. Therefore the bot's post-publication version commit does not cause
an unnecessary second Standard build. The actual DSH version remains a separate,
validated field in the contract.

Existing images without contract labels are deliberately not accepted as
downstream inputs. The first main Standard build bootstraps `dev` and queues the development editions.
Legacy published release aliases remain unchanged until a Git tag is published.
Project Git versions and installed DSH versions are separate fields; npm channels
remain metadata and do not decide public image aliases.

## Path and regression checks

`ci/release-paths.json` owns Standard's path classification. Both push gates read
it; tests compare it with Standard's workflow filters, including `.dockerignore`.

Relevant local checks:

```bash
node --test tests/test-release-contract.mjs
node tests/test-release-workflows.mjs
bash tests/test-research-release-gate.sh
bash tests/test-reverse-release-gate.sh
bash tests/test-image-tags.sh
bash research/tests/test-quarto-smoke.sh
```

The contract tests use real OCI bytes/digests and isolated Git repositories.
They cover mutable-tag movement, version/source mismatches, missing platforms,
authentication errors, partial releases, stale promotion and rerun behavior.
The Quarto test executes the actual native Dockerfile branch with failed,
empty-output and successful renderers.

Multi-platform container builds and runtime acceptance still run in CI. Reverse
uses native ARM64 runners for its process-ownership and browser checks; Standard
and Research retain their existing build/runtime coverage. This pipeline does
not lock all Python dependencies.
