/**
 * Phase 1: metadata-only DSH compaction compatibility probe.
 * Never writes sessions, registers a compaction service or invokes an LLM.
 */
export const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'
const BASIC = '@deepseek-ai/dsh-compaction-basic'
const COMMAND = '@deepseek-ai/dsh-command-compact'
const PRUNER = '@deepseek-ai/dsh-compaction-tool-result-pruner'
const BILI = new Set(['billion-context', 'bili-native'])
const EVENT_TYPES = new Set(['compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune'])
const MAX_PRESETS = 12

function safeName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : 'unknown'
}

/** Inspect a resolved preset's plugin tree without retaining prompts or config values. */
export function inspectPlugins(rows) {
  const found = {
    basic: { total: 0, enabled: 0, auto: 0 },
    manual: { total: 0, enabled: 0 },
    pruner: { total: 0, enabled: 0 },
    externalBili: { total: 0, enabled: 0 },
  }
  const seen = new WeakSet()
  function walk(items, depth = 0) {
    if (!Array.isArray(items) || depth > 24) return
    if (seen.has(items)) return
    seen.add(items)
    for (const row of items.slice(0, 1024)) {
      if (!row || typeof row !== 'object') continue
      const kind = row.name === BASIC ? 'basic' : row.name === COMMAND ? 'manual'
        : row.name === PRUNER ? 'pruner' : BILI.has(row.name) ? 'externalBili' : null
      if (kind) {
        found[kind].total++
        if (row.disabled !== true) {
          found[kind].enabled++
          if (kind === 'basic' && row.config?.auto !== false) found.basic.auto++
        }
      }
      if (Array.isArray(row.config)) walk(row.config, depth + 1)
      if (row.config && typeof row.config === 'object' && Array.isArray(row.config.plugins))
        walk(row.config.plugins, depth + 1)
    }
  }
  walk(rows)
  return found
}

export function inspectCompactionService(ctx) {
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('compaction') : undefined
    if (!service) return { available: false, scope: 'host-only', reason: 'not-visible-in-host-context' }
    return {
      available: true,
      scope: 'host-only',
      implementation: safeName(service.constructor?.name),
      compactIfNeeded: typeof service.compactIfNeeded === 'function',
      compactNow: typeof service.compactNow === 'function',
      compactRegion: typeof service.compactRegion === 'function',
    }
  } catch {
    return { available: false, scope: 'host-only', reason: 'service-probe-failed' }
  }
}

export function makeProbe(now = () => Date.now()) {
  const presets = []
  const events = { 'compaction/start': 0, 'compaction/summary': 0, 'compaction/end': 0, 'compaction/prune': 0 }
  const hooks = { presetConfigsObserved: 0, sessionEventsObserved: 0 }
  function observeConfig(entry, resolved) {
    if (entry?.options?.name !== AGENT_PRESET_PACKAGE || !Array.isArray(resolved?.plugins)) return
    hooks.presetConfigsObserved++
    const observation = {
      at: now(),
      id: safeName(resolved.id ?? resolved.name),
      plugins: inspectPlugins(resolved.plugins),
    }
    // Snapshot of bounded, sanitized metadata only. Repeated preset reloads keep the newest.
    presets.push(observation)
    if (presets.length > MAX_PRESETS) presets.shift()
  }
  function observeEvent(_session, event) {
    if (!event || !EVENT_TYPES.has(event.type)) return
    hooks.sessionEventsObserved++
    events[event.type]++
  }
  function snapshot(ctx) {
    const service = inspectCompactionService(ctx)
    const warnings = []
    if (!hooks.presetConfigsObserved) warnings.push('preset-overlay-not-observed: load order and scope unverified')
    if (!service.available) warnings.push('host-only-service-probe: per-agent service may exist outside this context')
    if (presets.some(p => p.plugins.externalBili.enabled))
      warnings.push('billion-context-present: presence does not prove compression ownership')
    return {
      schema: 1, phase: 'compatibility-probe', readonly: true, mutatesSessions: false,
      engine: 'not-installed', ownership: 'unverified',
      hooks: { ...hooks },
      hostCompaction: service,
      presets: presets.map(p => ({ at: p.at, id: p.id,
        plugins: Object.fromEntries(Object.entries(p.plugins).map(([k, v]) => [k, { ...v }])) })),
      events: { ...events },
      warnings,
    }
  }
  return { observeConfig, observeEvent, snapshot }
}
