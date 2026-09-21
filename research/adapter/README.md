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

Research images place a small `dsh` wrapper earlier on PATH. For the official
agent profiles:

```text
dsh web
dsh headless ...
dsh --profile web ...
dsh --profile headless ...
```

the wrapper injects:

```text
--patch /opt/dsh-research/adapter/cordis.patch.yml
```

All other DSH management commands preserve upstream behavior. Set
`DSH_RESEARCH_ADAPTER_DISABLE=1` to bypass the adapter for debugging.

The patch is invocation-local. It does not modify the persisted DSH profile.
