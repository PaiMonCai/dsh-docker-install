# DSH Docker Reasoning Editor

A deliberately small DSH Web extension for hand-declared `llm-pi-ai`
providers.

It has two deliberately separate surfaces:

1. The Models-page capability editor registers through DSH's official
   `settings.models.provider-card` slot and edits only the canonical per-model
   `reasoningEfforts` field through `remote.settings.mutate()`.
2. The Composer effort slider replaces only the open root body of DSH's model
   menu. DSH currently exposes no public replacement slot for this pane, so this
   mount is intentionally DOM-coupled. It discovers the official menu by
   `data-composer-card` + ARIA linkage, while all runtime state and mutations
   still use DSH's per-session `ModelDirectory` and `directory.select()`.

It does **not**:

- fork or patch DSH React source;
- discover or guess model capabilities;
- create another settings file or database;
- change provider credentials, endpoints, input modalities or compat flags;
- auto-fill reasoning levels;
- remember effort choices in browser storage;
- call provider/session HTTP APIs directly.

The Composer slider does not invent a second session state. It subscribes to
the same `ModelDirectory` used by DSH's official model selector and submits
`{ provider, model, reasoningEffort }` through that directory. The only
compatibility-sensitive seam is mounting the visual control into the official
menu because upstream has not published a Composer replacement slot yet.

The level keys are DSH selector values. Their optional text values are the
spellings sent by the configured protocol. For example, `max: xhigh` exposes
Max in DSH while sending `reasoning_effort=xhigh`.

The container entrypoint installs this package into the persistent `web`
profile through the existing `dsh plugin` command. Set
`DSH_REASONING_EDITOR=false` to keep/remove the built-in bundle.
