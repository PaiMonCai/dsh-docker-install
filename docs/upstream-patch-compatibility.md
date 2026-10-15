# Upstream patch compatibility audit

A green syntax check does not prove upstream compatibility. Keep `check-update.yml` preflight as a mandatory release gate; do not publish a failed candidate.

| Patch | Phase | Risk | Upstream dependency |
| --- | --- | --- | --- |
| `remote-settings` | docker-build | medium | dsh-client-ui-settings client.js |
| `connection-rpc-routes` | docker-build | high | client-connection rpc-host.js |
| `web-launch-token` | docker-build | high | browser launch-token generator |
| `workspace-picker-home` | docker-build | medium | workspace picker homedir() |
| `plugin-hub-origin` | runtime-profile | high | dsh-plugin profile routes |
| `dsh-market-container-restart` | runtime-profile | high | dshmarket profile restart/origin |

## Rules

1. Prefer upstream native capabilities to textual rewrites.
2. Fail closed for required behavior on unknown upstream layouts.
3. Validate legacy fixtures, published npm bundles, and runtime behavior separately.
4. Treat runtime profile patches separately from Docker build-time patches.
5. Remove a shim only after validating its replacement across supported versions.

## Removal criteria

- **remote-settings**: Host persistence supported in all maintained versions. Validation: Remote Settings regression and published alpha.3 check.
- **connection-rpc-routes**: Upstream route registration extension. Validation: RPC patch self-test and runtime smoke.
- **web-launch-token**: Upstream persistent token configuration. Validation: token patch self-test and Web login smoke.
- **workspace-picker-home**: Upstream workspace root setting. Validation: Docker build and workspace smoke.
- **plugin-hub-origin**: Upstream trusted proxy configuration. Validation: plugin patch self-test and reverse proxy smoke.
- **dsh-market-container-restart**: Upstream container-aware restart support. Validation: market patch self-test and restart smoke.
