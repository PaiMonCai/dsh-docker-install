import { normalizeSettings, resolvePolicy } from './policy.mjs'
import { BASIC, MANUAL, TIERED, ACP_TOOLS, GATE } from './takeover.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let bootSettings = null

// One immutable boot snapshot shared by the host plugin and its native children.
// Saving Settings cannot change ownership or a transaction already in flight.
export function configureNativePlugin(settings, env = process.env) {
  bootSettings = null
  const saved = normalizeSettings(settings)
  if (!saved.nativePlugin.enabled || env.DSH_CONTEXT_MANAGER_NATIVE_ACTIVE === '0') return null
  if (env.DSH_CONTEXT_MANAGER_TIERED_ACTIVE === '1' || env.DSH_CONTEXT_MANAGER_ACP_ACTIVE === '1')
    throw Error('native plugin and legacy lab activation cannot be combined')
  bootSettings = structuredClone(saved)
  return nativeBootSettings()
}
export function nativeBootSettings() {
  return bootSettings ? structuredClone(bootSettings) : null
}
export function sessionPreset(session) {
  const selected = session?.snapshotEvents?.().findLast(event=>event.type==='agent-preset/selected')
  return selected ? selected.data.agentPreset : session?.header?.agentPreset
}

export function externalContextPluginPresent(home = process.env.DSH_HOME || '/root/.dsh', env = process.env) {
  for (const directory of ['profiles', 'plugins']) {
    let entries
    try { entries = readdirSync(join(home, directory), { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      let manifest
      try { manifest = JSON.parse(readFileSync(join(home, directory, entry.name, 'package.json'), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const packages = [manifest.name, ...Object.keys(manifest.dependencies ?? {}),
        ...(manifest.dsh?.profile?.bundles ?? [])]
      if (packages.some(name => typeof name === 'string' && EXTERNAL.test(name))) return true
    }
  }
  return /\/bili\//i.test(env.HTTPS_PROXY || env.HTTP_PROXY || '')
}

const EXTERNAL = /(?:billion-context|(?:^|[\\/])bili-native)(?:$|[\\/])/i
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/

/** Replace exactly one native owner, preserving unrelated config and plugins. */
export function adaptNativePreset(preset, settings) {
  const unchanged = reason => ({ changed: false, config: preset, reason })
  if (!settings?.nativePlugin?.enabled) return unchanged('disabled')
  if (!ID.test(preset?.id ?? '')) return unchanged('unsupported-preset-id')
  const policy = resolvePolicy(settings, { agentId: preset.id })
  if (policy.engine !== 'tiered') return unchanged('native-policy-selected')
  // Different model modes would change tool availability inside an Agent.
  // Keep the original composition rather than claim such a switch is applied.
  if (settings.modelPolicies.some(row => row.engine && !['inherit', 'tiered'].includes(row.engine)))
    return unchanged('mixed-model-modes-unsupported')
  const seen = { basic: 0, manual: 0, acp: 0, tiered: 0, external: 0 }
  let count = 0
  const walk = (rows, depth = 0) => {
    if (!Array.isArray(rows) || depth > 20 || (count += rows.length) > 2048)
      throw Error('unsupported-plugin-tree')
    return rows.flatMap(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('unsupported-plugin-tree')
      if (row.disabled === true) return row
      if (typeof row.name !== 'string') throw Error('unsupported-plugin-name')
      const relevant = [BASIC, MANUAL, TIERED, ACP_TOOLS].includes(row.name) || EXTERNAL.test(row.name) || row.group === true
      if (relevant && row.disabled !== undefined && row.disabled !== false) throw Error('conditional-plugin-tree')
      if (row.id === 'native-acp-tools') throw Error('reserved-native-tools-id')
      if (EXTERNAL.test(row.name)) seen.external++
      if (row.name === ACP_TOOLS) seen.acp++
      if (row.name === TIERED) seen.tiered++
      if (row.name === MANUAL) seen.manual++
      if (row.name === BASIC) {
        seen.basic++
        if (row.config !== undefined && (!row.config || typeof row.config !== 'object' || Array.isArray(row.config)))
          throw Error('unsupported-basic-config')
        const original = row.config ?? {}
        const modelPolicies = settings.modelPolicies.filter(p => p.basic).map(p => ({
          ...(original.modelPolicies?.find(v => v.provider === p.provider && v.model === p.model) ?? {}),
          provider: p.provider, model: p.model, ...p.basic,
        }))
        const keys = new Set(modelPolicies.map(p => p.provider + '\0' + p.model))
        const config = { ...original, ...policy.basic,
          modelPolicies: [...(original.modelPolicies ?? []).filter(p => !keys.has(p.provider + '\0' + p.model)), ...modelPolicies] }
        delete config.retainTokens
        config.modelPolicies = config.modelPolicies.map(model => {
          const copy = { ...model }
          if (copy.retainRatio !== undefined) delete copy.retainTokens
          return copy
        })
        return [{ ...row, name: TIERED, config },
          { id: 'native-acp-tools', name: ACP_TOOLS, config: { mode: 'builtin' } }]
      }
      if (row.group === true) return { ...row, config: walk(row.config, depth + 1) }
      if (row.config && typeof row.config === 'object' && Array.isArray(row.config.plugins))
        return { ...row, config: { ...row.config, plugins: walk(row.config.plugins, depth + 1) } }
      return row
    })
  }
  try {
    const plugins = walk(preset.plugins)
    if (seen.external) return unchanged('external-context-plugin')
    if (seen.basic !== 1 || seen.manual !== 1 || seen.tiered || seen.acp)
      return unchanged('unsupported-compaction-ownership')
    // Tools and /compact remain siblings of the single engine, so native
    // dependency injection resolves the same service for all three.
    return { changed: true, config: { ...preset, plugins },
      evidence: { preset: preset.id, replaced: 1, manual: 1, external: 0, acp: true } }
  } catch (error) { return unchanged(String(error.message)) }
}

/** Build additive ordering gates from the actual boot-free DSH config dump. */
export function nativeOrderingPatches(tree) {
  let count = 0
  function visit(rows, depth = 0) {
    if (!Array.isArray(rows) || depth > 20 || (count += rows.length) > 4096) throw Error('unsupported launcher tree')
    const patches = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw Error('unsupported launcher entry')
      if (row.name === '@deepseek-ai/dsh-agent-preset' && row.disabled !== true) {
        if (!ID.test(row.id ?? '') || (row.inject !== undefined
          && (!Array.isArray(row.inject) || row.inject.some(name => typeof name !== 'string'))))
          throw Error('unsupported preset injection gate')
        patches.push({ id: row.id, inject: [...new Set([...(row.inject ?? []), GATE])] })
      }
      if (row.group === true) {
        const config = visit(row.config, depth + 1)
        if (config.length) {
          if (!ID.test(row.id ?? '')) throw Error('unsupported launcher group')
          patches.push({ id: row.id, config })
        }
      }
    }
    return patches
  }
  return visit(tree)
}

export function nativePluginStatus(settings, boot, compositions, inventory, reason = null) {
  const presets = [...compositions.values()].map(row => {
    const live = inventory?.presets?.find(p => p.id === row.preset)
    const active = row.changed && inventory?.available && !inventory.truncated
      && !live?.broken && !live?.rowLimitReached && live?.tiered?.active === 1
      && live?.basic?.active === 0 && live?.external?.configured === 0
      && live?.manual?.active === 1 && live?.acp?.active === 1
      && ['tiered', 'basic', 'external', 'manual', 'acp'].every(key => !live?.[key]?.conditional)
    return { preset: row.preset, state: active ? 'active' : row.changed ? 'awaiting-mount' : 'native-unchanged',
      reason: row.reason ?? null, configured: row.changed, mounted: !!active }
  })
  return { desiredEnabled: settings.nativePlugin.enabled, bootEnabled: !!boot,
    restartPending: JSON.stringify(settings) !== JSON.stringify(boot ?? { ...settings, nativePlugin: { ...settings.nativePlugin, enabled: false } }),
    activationBoundary: 'container-restart', reason,
    presets, ccrEnabled: !!boot?.nativePlugin.ccr,
    productionApproved: false, sharedHistoryApproved: false }
}
