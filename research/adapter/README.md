# DSH-native Research Adapter

The Research Adapter is the user-facing bridge between DeepSeek Harness agents and
the DSH Research Engine.

It deliberately keeps the existing Research CLI as the stable backend protocol:

```text
User
  ↓
DSH Agent (web / headless)
  ↓
DSH-native Research Adapter
  ↓
research-* CLI / Stable JSON API
  ↓
Research Engine
  ↓
files + manifests
```

The adapter is a zero-runtime-dependency Cordis plugin. It registers a small set
of high-level model-callable tools through `ctx.tools.register()`; it does not
fork or modify the Harness loop.

It also registers a concise `ctx.systemPrompt.section()` guidance block so the
Agent knows, even before a project-specific `AGENTS.md` exists, to prefer the
native Research tools over manually constructing backend CLI commands. Project
`AGENTS.md` files remain responsible for domain/research-specific rules.

## Model-visible tools

Research Core:

```text
research_project
research_data
research_pipeline
research_results
```

Research Economics additionally exposes:

```text
economics_did
economics_model
```

The small tool surface is intentional. The Agent should reason about research
goals and let the adapter translate them into stable CLI calls instead of
constructing long shell commands itself.

## Safety boundary

- Tool subprocesses use argv arrays; no shell interpolation is used.
- Project paths must stay below `/workspace` (or `DSH_RESEARCH_WORKSPACE`).
- Research subprocesses do not inherit environment variables whose names look
  like API keys, tokens, secrets, passwords, or credentials.
- `research_pipeline run` defaults to dry-run through the adapter.
- DiD/model estimation tools are available only when the Economics Pack binaries
  are installed.
- Standard images do not contain or load this plugin.

## Activation

Research images place a small `dsh` wrapper earlier on PATH. The wrapper
understands the current DSH launcher forms:

```text
dsh web ...
dsh --profile web ...
dsh --profile=web ...
dsh <custom-profile> ...
```

By default the Adapter is injected only into:

```text
web,headless
```

The compatibility set is configurable without editing the wrapper:

```bash
# Add a custom Agent profile.
export DSH_RESEARCH_ADAPTER_PROFILES=web,headless,tui

# Opt every booted profile into the Adapter.
export DSH_RESEARCH_ADAPTER_PROFILES='*'

# Disable the Adapter completely for upstream/debug checks.
export DSH_RESEARCH_ADAPTER_DISABLE=1
```

The wrapper preserves user `--patch` ordering, avoids injecting the Adapter
twice, leaves `plugin` commands untouched, and does not inject into
`--dump-default-config` because upstream explicitly forbids extra patches in
that mode.

The injected layer remains invocation-local and does not modify persisted DSH
profiles.

## Backend discovery

Research backends no longer have to live in one hard-coded directory. The
Adapter searches executables in this order:

```text
DSH_RESEARCH_BIN_DIR
        ↓
DSH_RESEARCH_BIN_PATH
        ↓
/usr/local/bin
        ↓
PATH
```

`DSH_RESEARCH_BIN_PATH` uses the platform path-list separator and can contain
multiple directories. This makes the same Adapter usable from source checkouts,
derived images, organization-specific layouts, and optional Research Packs.
