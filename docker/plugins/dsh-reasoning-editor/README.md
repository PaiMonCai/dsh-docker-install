# DSH Docker Reasoning Editor

A deliberately small DSH Web extension for hand-declared `llm-pi-ai`
providers.

DSH 0.2.1-rc.2 exposes reasoning-level editing in its native Models
form. This extension adds bulk editing using the same canonical field;
existing settings need no migration, and the native Composer owns selection.

It registers through DSH's official `settings.models.provider-card` slot and
edits only the canonical per-model `reasoningEfforts` field through
`remote.settings.mutate()`.

It does **not**:

- fork or patch DSH React source;
- discover or guess model capabilities;
- create another settings file or database;
- change provider credentials, endpoints, input modalities or compat flags;
- auto-fill reasoning levels.

## Bulk editing

The provider card now supports filtering models, selecting all or just filtered
models, applying one template to the selected model drafts, and saving changes
to the canonical settings in **one** revision-fenced mutation.

Applying is not saving. A separate confirmation persists only modified
`reasoningEfforts` fields, preserving all model metadata and unselected model
entries. Concurrent changes to a targeted model's reasoning profile cause a
refusal instead of a silent overwrite. The individual editors remain available
for fine-grained overrides after the batch draft is applied.

The level keys are DSH selector values. Their optional text values are the
spellings sent by the configured protocol. For example, `max: xhigh` exposes
Max in DSH while sending `reasoning_effort=xhigh`.

The image bundles this package at `/opt/dsh/plugins/dsh-reasoning-editor/`.
The entrypoint loads its `cordis.patch.yml` through the native DSH launcher
`--patch` option, without running `dsh plugin add` or pnpm. Set
`DSH_REASONING_EDITOR=false` and recreate the container to omit this overlay.
Saved reasoning settings remain available to the native Models form and Composer.

See [the user guide](../../../docs/reasoning-editor.md) for configuration,
conflict handling and the retirement of historical profile bundle selections.
