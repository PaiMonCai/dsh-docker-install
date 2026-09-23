#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="docker/plugins/dsh-reasoning-editor"
CLIENT="$PLUGIN_DIR/client.js"
PACKAGE="$PLUGIN_DIR/package.json"
RECONCILER="docker/ensure-reasoning-editor.sh"

node --check "$PLUGIN_DIR/index.js"
node --check "$CLIENT"
bash -n "$RECONCILER"

node - "$PACKAGE" <<'NODE'
const fs = require('fs')
const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (pkg.name !== 'dsh-docker-reasoning-editor') throw new Error('unexpected package name')
if (pkg.dependencies && Object.keys(pkg.dependencies).length !== 0) {
  throw new Error('built-in reasoning editor must not add runtime dependencies')
}
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('bundle patch missing')
if (pkg.dsh?.client?.platform !== 'web') throw new Error('web client manifest missing')
NODE

# Architectural boundary: use DSH's supported extension and Settings surfaces.
grep -Fq "settings.models.provider-card" "$CLIENT"
grep -Fq "remote.settings" "$CLIENT"
grep -Fq "settings.mutate(" "$CLIENT"
grep -Fq "reasoningEfforts" "$CLIENT"
grep -Fq "sliderRail" "$CLIENT"
grep -Fq "'aria-pressed': selected" "$CLIENT"
grep -Fq "provider.declared !== true" "$CLIENT"

# llm-pi-ai model profiles do not accept a model-level defaultReasoningEffort;
# provider/session defaults remain owned by upstream DSH.
if grep -Fq "defaultReasoningEffort" "$CLIENT"; then
  echo "reasoning editor must not write unsupported model-level defaultReasoningEffort" >&2
  exit 1
fi

# The Models-page editor must stay on the official slot/settings contract.
# Composer currently exposes no replacement slot, so the only DOM-coupled
# surface is the narrowly-scoped composer menu mount. Model/session state must
# still come from DSH's ModelDirectory and selection must use directory.select().
grep -Fq "MutationObserver" "$CLIENT"
grep -Fq "[data-composer-card]" "$CLIENT"
grep -Fq 'button[aria-haspopup="menu"][aria-controls]' "$CLIENT"
grep -Fq "modelDirectories" "$CLIENT"
grep -Fq "directoryFor(sessionId)" "$CLIENT"
grep -Fq "mount.directory.select(selection)" "$CLIENT"
grep -Fq "if (chosen.id !== undefined) selection.reasoningEffort = chosen.id" "$CLIENT"
grep -Fq "input.type = 'range'" "$CLIENT"

# The DOM mount is presentation-only: no parallel persistence or direct API.
if grep -Eq "localStorage|indexedDB|fetch\(" "$CLIENT"; then
  echo "composer slider must not introduce browser persistence or direct network calls" >&2
  exit 1
fi

# Lifecycle belongs to DSH Plugin Manager. The reconciler may inspect the
# manifest for idempotency, but must never write it itself.
grep -Fq 'dsh plugin --profile "$PROFILE" add' "$RECONCILER"
grep -Fq 'dsh plugin --profile "$PROFILE" remove' "$RECONCILER"
if grep -Eq 'writeFile|sed .*package\.json|>.*package\.json|mv .*package\.json|cp .*package\.json' "$RECONCILER"; then
  echo "reasoning editor reconciler must not mutate the profile manifest directly" >&2
  exit 1
fi

echo "reasoning editor architecture checks passed"
