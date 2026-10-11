# DSH Docker Reasoning Editor

A deliberately small DSH Web extension for hand-declared `llm-pi-ai`
providers.

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

The container entrypoint installs this package into the persistent `web`
profile through the existing `dsh plugin` command. Set
`DSH_REASONING_EDITOR=false` to keep/remove the built-in bundle.
