# Built-in native billion-context plugin

Owner: `docker/plugins/dsh-context-manager`. Started 2026-10-23.

## Product contract

The image contains the plugin and pinned upstream Kernel. An operator enables
billion-context in the existing Settings surface and restarts the container.
No extra install, proxy, model route, or experimental environment variables are
required. A restart is the activation boundary: running Agents never change
compaction ownership halfway through a request.

Disabled means the original preset configuration is preserved. Enabled means
one native BasicCompactionEngine subclass and scoped ACP tools, using the same
Session, ToolRuntime, provider configuration, permissions, native transactions,
manual compaction and overflow recovery. Unsupported or conflicting preset
compositions remain native and report their reason. The plugin never grants
shared history access or introduces another conversation store.

## Implementation plan

1. **Configuration and composition:** add an explicit persisted plugin switch,
   migrate old settings without activating old saved intentions, automatically
   order plugin startup through additive launcher overlays, and adapt eligible
   native preset compositions without changing their other plugins.
2. **Runtime and rollback:** bind settings to the boot composition; mount native
   tools, prompts and optional CCR with no lab flags; retain pressure, overflow,
   manual transactions, original data and cold retrieval on disable/re-enable.
3. **Settings experience:** enable/disable from Settings; distinguish saved,
   boot-applied, mounted and skipped states; show restart pending and actual
   per-preset results. Preserve the existing Settings design language.
4. **Acceptance:** verify default-native, enabled, disabled and re-enabled
   lifecycle, incompatible/external owners, immutable logs, tools/prompts,
   pressure/overflow/manual behavior, and packaged offline AgentLoop. Exercise
   container restart over a disposable volume and derived images in CI.

## Evidence and completion

Each step records its implementation and exact validation result here. Local
source checks, actual native runtime tests, exact-head CI and paid-provider
measurements are different evidence. No real-provider savings or production
readiness is inferred from an offline adapter. Provider workloads remain a
separate operator-run acceptance; this work must deliver their runnable
procedure without requiring credentials or charges to develop the plugin.

Steps 1-3 are implemented: a persisted master switch, additive boot ordering,
compatible-preset composition, immutable boot policy, scoped historical readers,
native summary fallback and Settings controls with actual runtime reporting.
Step 4 has authored native AgentLoop/CCR/policy and container lifecycle checks.
Exact-head hosted results are pending and will be attached to the PR.

Local results: 54 targeted lifecycle/UI/existing regressions, 21 pinned-upstream
regressions and 29 release/parity checks pass. JavaScript and shell syntax checks
pass. The old Linux-only settings tests encounter Windows directory-fsync and
symlink EPERM errors locally; their required Linux execution remains in CI.
No local Docker runtime is available. No deployment, new release tag or
production activation is requested by this plan. Operator instructions and the
separate Provider comparison procedure are in [the user guide](context-manager-native-plugin.md).
