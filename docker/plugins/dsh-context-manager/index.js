import { makeProbe } from './core.mjs'

export const name = 'dsh-docker-context-manager'
export const inject = []
export const ENDPOINT = '/dsh-docker-context-manager'

/**
 * Read-only Phase 1 adapter. Hooks see metadata only; they MUST NOT shadow or
 * mutate session events or replace the official ctx.compaction service.
 */
export function apply(ctx) {
  const probe = makeProbe()
  ctx.on('internal/config', function (_raw, next) {
    const resolved = next()
    try { probe.observeConfig(this?.entry, resolved) }
    catch (error) { ctx.logger?.warn?.('context-manager preset probe failed: ' + String(error?.message || error)) }
    return resolved
  }, { global: true })

  ctx.on('session/event', (session, event) => {
    try { probe.observeEvent(session, event) }
    catch (error) { ctx.logger?.warn?.('context-manager event probe failed: ' + String(error?.message || error)) }
  }, { global: true })

  ctx.inject(['connection'], c => {
    c.connection.rpc.handle(ENDPOINT, async (method, payload = {}) => {
      if (method !== 'status' || !payload || typeof payload !== 'object'
        || Array.isArray(payload) || Object.keys(payload).length !== 0) {
        return { ok: false, error: { code: 'invalid_request', message: 'phase 1 is read-only' } }
      }
      return { ok: true, value: probe.snapshot(ctx) }
    })
  })
}

export default { name, inject, apply }
