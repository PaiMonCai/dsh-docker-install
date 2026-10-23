import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const LOG_PREFIX = 'DSH_CONTEXT_EVENT '
const events = {
  'plugin.boot': 'info', 'preset.composed': 'info', 'preset.observed': 'info',
  'engine.mounted': 'info', 'engine.trigger': 'debug', 'engine.deferred': 'debug', 'tools.mounted': 'info',
  'acp.proposed': 'debug', 'acp.committed': 'info', 'acp.refused': 'warn',
  'ccr.stored': 'info', 'ccr.skipped': 'debug', 'ccr.failed': 'warn', 'tool.completed': 'debug', 'tool.refused': 'warn',
  'summary.started': 'debug', 'summary.completed': 'info', 'summary.fallback': 'warn',
  'summary.cancelled': 'info', 'compaction.closed': 'info', 'request.attempt': 'debug',
  'request.usage': 'debug', 'summary.usage': 'debug',
  'readers.mounted': 'info', 'observation.failed': 'warn',
}
const reasons = new Set(['unknown', 'cancelled', 'durability', 'stale-surface', 'invalid-range',
  'native-transaction', 'kernel-rejected', 'summary-invalid', 'storage-refused', 'integrity', 'missing-history',
  'not-large-or-protected', 'unsupported-result', 'nested', 'oversized', 'permission-denied', 'policy-preserved',
  'startup-disabled', 'startup-incompatible', 'disabled', 'unsupported-preset-id', 'native-policy-selected',
  'mixed-model-modes-unsupported', 'unsupported-plugin-tree', 'unsupported-plugin-name',
  'unsupported-basic-config', 'conditional-plugin-tree', 'reserved-native-tools-id',
  'external-context-plugin', 'unsupported-compaction-ownership', 'cache-read-unknown',
  'input-total-unknown', 'output-unknown', 'inconsistent-native-total', 'inconsistent-native-input',
  'cached-exceeds-input', 'invalid-provider-counter'])
const modes = new Set(['builtin', 'lab', 'read-only', 'native', 'native-acp'])
const tools = new Set(['acp_status', 'acp_cache', 'acp_compress', 'compress', 'acp_decompress',
  'decompress', 'absorb', 'acp_search_context', 'search_context', 'acp_retrieve', 'retrieve', 'acp_ccr_retrieve'])
const numbers = ['seq', 'startSeq', 'endSeq', 'tier', 'sourceCount', 'summaryChars', 'originalChars',
  'projectedChars', 'elapsedMs', 'input', 'cached', 'output', 'cacheWrite', 'suppressed']
const booleans = ['enabled', 'ccrEnabled', 'changed', 'mounted', 'restartPending', 'known', 'success', 'historical']
const sharedBudget = { start: null, written: 0, suppressed: 0 }
const boot = randomBytes(8).toString('hex')
let provenance = {}
try {
  const source = JSON.parse(readFileSync(new URL('vendor/provenance.json', import.meta.url), 'utf8'))
  if (/^[0-9a-z.-]{1,80}$/.test(source.version) && /^[a-f0-9]{40}$/.test(source.upstream?.commit))
    provenance = { kernelVersion: source.version, kernelCommit: source.upstream.commit }
} catch {}
const fingerprint = value => typeof value === 'string' && value.length > 0
  ? createHash('sha256').update(value).digest('hex').slice(0, 16) : undefined

export function diagnosticReason(error) {
  try {
    if (error?.name === 'AbortError' || /aborted|cancelled/i.test(error?.message ?? '')) return 'cancelled'
    const message = String(error?.message ?? '')
    if (/durab|persist|flush|disk|ENOSPC/i.test(message)) return 'durability'
    if (/surface|state changed|no longer visible/i.test(message)) return 'stale-surface'
    if (/integrity|hash mismatch/i.test(message)) return 'integrity'
    if (/unavailable|unknown .*block|inactive/i.test(message)) return 'missing-history'
    if (/permission|denied/i.test(message)) return 'permission-denied'
    if (/kernel rejected/i.test(message)) return 'kernel-rejected'
    if (/summary quality gate|summarizer.*(reject|no text)|summary.*truncated/i.test(message)) return 'summary-invalid'
    if (/range|bound|ref|pair|protected|unclosed/i.test(message)) return 'invalid-range'
    if (/compaction|checkpoint|transaction/i.test(message)) return 'native-transaction'
  } catch {}
  return 'unknown'
}

/** Metadata-only console logs. A broken or overloaded logger never changes native outcomes. */
export function createDiagnostics(logger, { level = process.env.DSH_CONTEXT_MANAGER_LOG_LEVEL ?? 'info',
  now = Date.now, budget = sharedBudget, limit = 240 } = {}) {
  const levels = { off: 0, warn: 1, info: 2, debug: 3 }
  const selected = Object.hasOwn(levels, level) ? levels[level] : levels.info
  return (event, fields = {}) => {
    try {
      const severity = Object.hasOwn(events, event) ? events[event] : null
      if (!severity || selected < levels[severity]) return false
      const write = severity === 'debug' ? logger?.info ?? logger?.debug : logger?.[severity]
      if (typeof write !== 'function') return false
      const at = now()
      if (budget.start === null || at - budget.start >= 60000 || at < budget.start) {
        budget.start = at; budget.written = 0
      }
      if (budget.written >= limit) { budget.suppressed++; return false }
      const row = { schema: 'dsh-context-log/v1', at, boot, level: severity, event, ...provenance }
      for (const name of ['session', 'preset', 'provider', 'model', 'callId', 'compactionId']) {
        const value = name === 'session' ? fields.session?.id : fields[name]
        const id = fingerprint(value)
        if (id) row[name + 'Hash'] = id
      }
      for (const name of numbers) {
        const value = fields[name]
        if (value === null && ['input', 'cached', 'output', 'cacheWrite'].includes(name)) row[name] = null
        else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)
          row[name] = name === 'elapsedMs' ? Math.round(value * 1000) / 1000 : value
      }
      for (const name of booleans) if (typeof fields[name] === 'boolean') row[name] = fields[name]
      if (fields.reason !== undefined) row.reason = reasons.has(fields.reason) ? fields.reason : 'unknown'
      if (modes.has(fields.mode)) row.mode = fields.mode
      if (tools.has(fields.tool)) row.tool = fields.tool
      if (typeof fields.blockId === 'string' && /^b[1-9][0-9]{0,9}$/.test(fields.blockId)) row.blockId = fields.blockId
      if (['pressure', 'overflow', 'context-overflow', 'manual'].includes(fields.trigger)) row.trigger = fields.trigger
      if (['active', 'awaiting-mount', 'native-unchanged'].includes(fields.state)) row.state = fields.state
      if (budget.suppressed) row.suppressed = budget.suppressed
      const delivery=write.call(logger, LOG_PREFIX + JSON.stringify(row))
      if(delivery&&typeof delivery.then==='function')void Promise.resolve(delivery).catch(()=>{})
      budget.written++; budget.suppressed = 0
      return true
    } catch { return false }
  }
}
