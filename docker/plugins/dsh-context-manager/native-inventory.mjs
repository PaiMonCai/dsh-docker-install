/**
 * Inspect the *official* agent-preset composition inventory, not an
 * app-owned copy of preset YAML. It distinguishes configured entries from
 * the runtime's active Fiber states without loading/mounting a preset.
 *
 * Privacy: never return names/paths of arbitrary plugins, conditions,
 * configuration payloads, prompts, session IDs, or raw error messages.
 */
const NATIVE_BASIC = '@deepseek-ai/dsh-compaction-basic'
const NATIVE_TIERED = '/opt/dsh/plugins/dsh-context-manager/tiered-native.js'
const NATIVE_MANUAL = '@deepseek-ai/dsh-command-compact'
const NATIVE_PRUNER = '@deepseek-ai/dsh-compaction-tool-result-pruner'
const EXTERNAL = new Set(['billion-context', 'bili-native'])
const LIMIT_PRESETS = 32
const LIMIT_ROWS = 2048
const FIBER_ACTIVE = 2

function cleanId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(id) ? id : 'unknown'
}
function metric() { return { configured: 0, active: 0, conditional: 0 } }
function resultRow(id, rows, broken) {
  const categories = { basic: metric(), tiered: metric(), manual: metric(), pruner: metric(), external: metric() }
  const list = Array.isArray(rows) ? rows.slice(0, LIMIT_ROWS) : []
  let mounted = false
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const key = row.moduleName === NATIVE_BASIC ? 'basic'
      : row.moduleName === NATIVE_TIERED ? 'tiered'
      : row.moduleName === NATIVE_MANUAL ? 'manual'
      : row.moduleName === NATIVE_PRUNER ? 'pruner'
      : EXTERNAL.has(row.moduleName) ? 'external' : null
    if (row.fiberState === FIBER_ACTIVE) mounted = true
    if (!key) continue
    if (row.enabled === 'conditional') categories[key].conditional++
    else if (row.enabled === true) {
      categories[key].configured++
      if (row.fiberState === FIBER_ACTIVE) categories[key].active++
    }
  }
  const native = categories.basic
  const external = categories.external
  const unknown = native.conditional > 0 || external.conditional > 0 || categories.tiered.conditional > 0
  // This is a preset-local statement only: an independent host-plane
  // compactor or remote bili interception is NOT observable in this source.
  const ownership = broken ? 'preset-broken'
    : unknown ? 'unverified-conditional'
    : categories.tiered.configured && (native.configured || external.configured) ? 'conflict-risk'
    : categories.tiered.configured > 1 ? 'duplicate-tiered-risk'
    : categories.tiered.active===1 ? 'preset-tiered-lab-active'
    : native.configured && external.configured ? 'conflict-risk'
    : native.configured > 1 ? 'duplicate-native-risk'
    : native.active === 1 ? 'preset-native-active'
    : native.configured === 1 ? 'preset-native-configured'
    : external.active ? 'external-plugin-active-unverified'
    : external.configured ? 'external-plugin-configured-unverified'
    : 'no-preset-compaction'
  return {
    id: cleanId(id), mounted, ownership,
    basic: { ...native }, manual: { ...categories.manual },
    pruner: { ...categories.pruner }, tiered: { ...categories.tiered }, external: { ...external },
    rowLimitReached: Array.isArray(rows) && rows.length > LIMIT_ROWS,
    broken: !!broken,
  }
}

/** Pure projection of DSH's AgentPresetComposition[] (untrusted, read-only). */
export function projectCompositions(compositions) {
  if (!Array.isArray(compositions)) return []
  return compositions.slice(0, LIMIT_PRESETS).map(p =>
    resultRow(p?.id, p?.rows, p?.broken))
}

export async function inspectRuntimePresets(ctx) {
  let registry
  try { registry = ctx.get?.('agentPresets') }
  catch { return { available: false, reason: 'registry-unavailable', presets: [] } }
  if (typeof registry?.compositionInventory !== 'function')
    return { available: false, reason: 'composition-inventory-unavailable', presets: [] }
  try {
    const compositions = await registry.compositionInventory()
    if (!Array.isArray(compositions))
      return { available: false, reason: 'invalid-composition-inventory', presets: [] }
    return {
      available: true, source: 'agentPresets.compositionInventory', scope: 'preset-only',
      count: compositions.length, truncated: compositions.length > LIMIT_PRESETS,
      presets: projectCompositions(compositions),
    }
  } catch {
    return { available: false, reason: 'composition-inventory-error', presets: [] }
  }
}
