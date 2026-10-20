/** DSH Context Manager schema-v2: configuration intent, not runtime ownership. */
export const DEFAULT_SETTINGS = Object.freeze({
  schema: 2,
  engine: 'basic',
  basic: { auto: true, thresholdRatio: 0.75, retainRatio: 0.20, headroomTokens: 65536 },
  tiered: { nudgeGrowthTokens: 30000, preserveRecentMessages: 5,
    preserveRecentTokens: 8000, tiers: true, retrievalEnabled: true },
  agentPolicies: [],
  modelPolicies: [],
})
export const ENGINES = Object.freeze(['basic', 'tiered', 'off'])
const KEYS = obj => Object.keys(obj)
function object(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || KEYS(value).some(k => !keys.includes(k))) throw Error('invalid ' + label)
}
function number(value, min, max, integer, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
    || integer && !Number.isInteger(value)) throw Error('invalid ' + label)
  return value
}
function bool(value, label) {
  if (typeof value !== 'boolean') throw Error('invalid ' + label)
  return value
}
function engine(value, label, inherit = false) {
  if (!(inherit ? ['inherit', ...ENGINES] : ENGINES).includes(value)) throw Error('invalid ' + label)
  return value
}
function identifier(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
    || !/^[A-Za-z0-9_.:/@+-]+$/.test(value) || value.includes('..')
    || value.startsWith('/')) throw Error('invalid ' + label)
  return value
}
export function validateBasic(value, partial = false) {
  object(value, ['auto','thresholdRatio','retainRatio','headroomTokens'], 'basic policy')
  const result = {}
  for (const k of ['auto', 'thresholdRatio', 'retainRatio', 'headroomTokens']) {
    if (!Object.hasOwn(value, k)) {
      if (!partial) throw Error('missing basic.' + k)
      continue
    }
    result[k] = k === 'auto' ? bool(value[k], k)
      : k === 'thresholdRatio' ? number(value[k], 0.40, 0.90, false, k)
      : k === 'retainRatio' ? number(value[k], 0.05, 0.40, false, k)
      : number(value[k], 0, 262144, true, k)
  }
  if (!partial && result.retainRatio >= result.thresholdRatio)
    throw Error('retention ratio must be lower than threshold ratio')
  return result
}
export function validateTiered(value, partial = false) {
  object(value, ['nudgeGrowthTokens', 'preserveRecentMessages','preserveRecentTokens','tiers','retrievalEnabled'], 'tiered policy')
  const result = {}
  for (const k of ['nudgeGrowthTokens','preserveRecentMessages','preserveRecentTokens','tiers','retrievalEnabled']) {
    if (!Object.hasOwn(value, k)) {
      if (!partial) throw Error('missing tiered.' + k)
      continue
    }
    result[k] = ['tiers','retrievalEnabled'].includes(k) ? bool(value[k], k)
      : k === 'nudgeGrowthTokens' ? number(value[k], 1000, 200000, true, k)
      : k === 'preserveRecentMessages' ? number(value[k], 0, 50, true, k)
      : number(value[k], 0, 100000, true, k)
  }
  return result
}
function override(item, kind) {
  const keys = kind === 'agent' ? ['agentId','engine','basic','tiered']
    : ['provider','model','engine','basic','tiered']
  object(item, keys, kind + ' override')
  const result = kind === 'agent' ? { agentId: identifier(item.agentId, 'agentId') }
    : { provider: identifier(item.provider, 'provider'), model: identifier(item.model, 'model') }
  if (Object.hasOwn(item, 'engine')) result.engine = engine(item.engine, 'override.engine', true)
  if (Object.hasOwn(item, 'basic')) result.basic = validateBasic(item.basic, true)
  if (Object.hasOwn(item, 'tiered')) result.tiered = validateTiered(item.tiered, true)
  if (!Object.hasOwn(result, 'engine') && !Object.hasOwn(result, 'basic') && !Object.hasOwn(result, 'tiered'))
    throw Error('empty ' + kind + ' override')
  return result
}
function overrides(value, kind) {
  if (!Array.isArray(value) || value.length > 32) throw Error('invalid ' + kind + ' policy list')
  const seen = new Set()
  return value.map(v => {
    const item = override(v, kind)
    const key = kind === 'agent' ? item.agentId : item.provider + '\0' + item.model
    if (seen.has(key)) throw Error('duplicate ' + kind + ' override')
    seen.add(key)
    return item
  })
}
export function normalizeSettings(data) {
  object(data, ['schema','engine','basic','tiered','agentPolicies','modelPolicies'], 'settings')
  if (data.schema !== 2) throw Error('unsupported settings schema')
  return {
    schema: 2, engine: engine(data.engine, 'engine'),
    basic: validateBasic(data.basic), tiered: validateTiered(data.tiered),
    agentPolicies: overrides(data.agentPolicies, 'agent'),
    modelPolicies: overrides(data.modelPolicies, 'model'),
  }
}
export function defaults() { return structuredClone(DEFAULT_SETTINGS) }
export function resolvePolicy(data, { agentId, provider, model } = {}) {
  const config = normalizeSettings(data)
  let result = { engine: config.engine, basic: { ...config.basic }, tiered: { ...config.tiered } }
  const patch = entry => {
    if (!entry) return
    if (entry.engine && entry.engine !== 'inherit') result.engine = entry.engine
    if (entry.basic) Object.assign(result.basic, entry.basic)
    if (entry.tiered) Object.assign(result.tiered, entry.tiered)
  }
  if (agentId) patch(config.agentPolicies.find(row => row.agentId === agentId))
  if (provider && model) patch(config.modelPolicies.find(row => row.provider === provider && row.model === model))
  if (result.basic.retainRatio >= result.basic.thresholdRatio)
    throw Error('resolved retention ratio must be below threshold ratio')
  return result
}
/** DSH's native pressure formula; reports calculated budget, not a guarantee. */
export function previewNative(settings, { contextWindow, reservedOutput } = {}) {
  const basic = settings.basic ?? settings
  const w = number(contextWindow, 1024, 20000000, true, 'contextWindow')
  const out = number(reservedOutput, 1, w - 1, true, 'reservedOutput')
  const threshold = Math.max(0, Math.floor(Math.min(w * basic.thresholdRatio,
    w - out - basic.headroomTokens)))
  return {
    contextWindow: w, reservedOutput: out,
    thresholdTokens: threshold,
    retainedRecentTokens: Math.floor((w - out) * basic.retainRatio),
    pressuredByHeadroom: w * basic.thresholdRatio > w - out - basic.headroomTokens,
    note: 'estimate-only; cannot certify routed model context limits or actual compaction ratio',
  }
}
