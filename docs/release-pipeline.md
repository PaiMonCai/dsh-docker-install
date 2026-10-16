# Image release pipeline

Standard follows upstream DSH. Research, Research Economics and Reverse consume
the successful Standard artifact; they do not independently install upstream DSH.

## Release contract

Standard publishes a `linux/amd64` + `linux/arm64` index. Both platform configs
must agree on these labels:

| Label | Meaning |
| --- | --- |
| `io.caicailo.dsh.version` | Installed upstream DSH version |
| `io.caicailo.dsh.edition` | `standard`, `research`, `research-economics`, or `reverse` |
| `io.caicailo.dsh.standard.revision` | Standard source commit |
| `io.caicailo.dsh.source.tree` | Hash of the relevant edition's tracked source |
| `io.caicailo.dsh.channels` | npm channel snapshot taken by Standard |
| `io.caicailo.dsh.base.digest` | Standard index digest, on derivatives |
| `org.opencontainers.image.revision` | This edition's source commit |

`ci/registry.mjs` reads and verifies index, manifest and config digests. Only the
configured GHCR repository is accepted. Version/source constraints are checked
against the artifact, including agreement between architectures.

## Build and promotion

1. Standard runs its source compatibility and real runtime/browser audits.
2. Multi-platform builds push only `candidate-<edition>-<run>-<attempt>` tags.
3. A separate promotion job fetches current main while holding the shared
   promotion lock. It rejects stale edition source and DSH version downgrades.
   Derivatives must still use the currently published Standard digest.
4. Promotion copies the validated index to version, channel and floating tags.
5. Standard independently queues Research and Reverse with the immutable
   `image@sha256:...` reference and Standard provenance.

Every downstream workflow checks out its own `github.sha`, matching its workflow
definition. The legacy input name `source_sha` describes **Standard provenance**;
it never selects downstream source.

Downstream preparation resolves the base once. Both Research matrix targets,
Reverse audits, and Reverse publication reuse that exact digest. If main has
unpublished Standard source changes, standalone downstream builds wait for the
Standard dispatch. PRs changing Standard build a local candidate base instead
of pulling a not-yet-published version tag.

Builds do not share a cancelling workflow lock. Only short promotion jobs are
serialized. Their shared lock uses `queue: max` so pending promotions wait
instead of replacing one another. The updater also queues concurrent requests.

Candidate suffixes are outputs of the producing jobs. Rerunning a failed
promotion reuses the original candidate rather than assuming it was built in
the new run attempt. A failed Research matrix item can be rebuilt while retaining
the other successful item; promotion requires both targets to succeed.

Standard and Reverse amd64 audits only import the shared release cache. The
multi-platform build exports it afterwards, preserving ARM64 entries between
runs. The updater sets `skip_dispatch: true`; other triggers dispatch by default,
including push events where workflow inputs are absent.

## Automatic updates and recovery

`Check dsh Updates` runs daily and can also be dispatched manually.

- It checks the published Standard contract even when npm and Dockerfile versions
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
  Standard release; a warning is recorded and reconciliation retries it.

The Standard source hash normalizes only the recorded DSH version in Dockerfile
and Compose. Therefore the bot's post-publication version commit does not cause
an unnecessary second Standard build. The actual DSH version remains a separate,
validated field in the contract.

Existing images without contract labels are deliberately not accepted as
downstream inputs. The first Standard build after this change bootstraps the
contract and then queues all editions.

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

Multi-platform container builds and runtime acceptance still run in CI. This
pipeline does not lock all Python dependencies or provide native ARM64 runners;
those are separate reproducibility and runtime-coverage improvements.
