import { makeProbe } from './core.mjs'
import { inspectRuntimePresets } from './native-inventory.mjs'

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

  // CI-only real startup proof: this listener never creates sessions or
  // mounts agents. The Reverse runtime's own preset smoke handles mounting.
  const expected = process.env.DSH_CONTEXT_MANAGER_CI_EXPECT_PRESETS
    ?.split(',').filter(x => /^[A-Za-z0-9_.:-]{1,100}$/.test(x)) ?? []
  if (expected.length && typeof ctx.effect === 'function') {
    ctx.effect(() => {
      let stopped = false
      let checking = false
      let checks = 0
      const check = async () => {
        if (stopped || checking) return
        checking = true
        try {
          const inventory = await inspectRuntimePresets(ctx)
          if (inventory.available && expected.every(p => inventory.presets.some(row => row.id === p))) {
            const result = expected.map(p => {
              const row = inventory.presets.find(item => item.id === p)
              return p + ':' + (row.mounted ? 'mounted' : 'declared')
            }).join(',')
            process.stdout.write('DSH_CONTEXT_MANAGER_CI_READY ' + result + '\\n')
            stopped = true; clearInterval(timer)
          } else if (++checks >= 80) {
            process.stderr.write('DSH_CONTEXT_MANAGER_CI_FAILED missing runtime preset inventory\\n')
            stopped = true; clearInterval(timer)
          }
        } finally { checking = false }
      }
      const timer = setInterval(() => { void check() }, 500)
      timer.unref?.()
      void check()
      return () => { stopped = true; clearInterval(timer) }
    }, 'CI read-only context-manager runtime inventory check')
  }

  ctx.inject(['connection'], c => {
    c.connection.rpc.handle(ENDPOINT, async (method, payload = {}) => {
      if (method !== 'status' || !payload || typeof payload !== 'object'
        || Array.isArray(payload) || Object.keys(payload).length !== 0) {
        return { ok: false, error: { code: 'invalid_request', message: 'phase 1 is read-only' } }
      }
      const nativePresets = await inspectRuntimePresets(ctx)
      return { ok: true, value: { ...probe.snapshot(ctx), nativePresets } }
    })
  })
}

export default { name, inject, apply }
