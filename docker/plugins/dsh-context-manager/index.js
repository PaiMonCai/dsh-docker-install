import { makeProbe } from './core.mjs'
import { inspectRuntimePresets } from './native-inventory.mjs'
import { defaults, normalizeSettings, resolvePolicy, previewNative } from './policy.mjs'
import { readSettings, writeSettings, settingsRevision } from './storage.mjs'

export const name = 'dsh-docker-context-manager'
export const inject = []
export const ENDPOINT = '/dsh-docker-context-manager'

/**
 * Phase 2: read-only native compaction observer with durable policy intentions.
 * No policy is applied to a live compaction service until ownership is verified.
 */
export function apply(ctx) {
  const probe = makeProbe()
  // The boot revision is evidence of what this *plugin* read, NOT proof that an
  // upstream compactor loaded these values. Do not claim a configuration is live.
  let bootRevision = null
  try { bootRevision = settingsRevision(readSettings()) }
  catch { ctx.logger?.warn?.('Context Manager settings unavailable at boot; native compaction unchanged') }
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
  const requireMounted = process.env.DSH_CONTEXT_MANAGER_CI_REQUIRE_MOUNTED === '1'
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
          if (inventory.available && expected.every(p => inventory.presets.some(row =>
            row.id === p && (!requireMounted || row.mounted)))) {
            const result = expected.map(p => {
              const row = inventory.presets.find(item => item.id === p)
              return p + ':' + (row.mounted ? 'mounted' : 'declared')
            }).join(',')
            process.stdout.write('DSH_CONTEXT_MANAGER_CI_READY ' + result + '\n')
            stopped = true; clearInterval(timer)
          } else if (++checks >= 80) {
            process.stderr.write('DSH_CONTEXT_MANAGER_CI_FAILED missing runtime preset inventory\n')
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
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
          throw Error('invalid request payload')
        if (method === 'status' && Object.keys(payload).length === 0) {
          const nativePresets = await inspectRuntimePresets(ctx)
          return { ok: true, value: { ...probe.snapshot(ctx), nativePresets } }
        }
        if (method === 'settings' && Object.keys(payload).length === 0) {
          const settings = readSettings()
          const revision = settingsRevision(settings)
          const nativePresets = await inspectRuntimePresets(ctx)
          return { ok: true, value: {
            settings, revision, nativePresets, events: probe.snapshot(ctx).events,
            runtime: { applied: false, effectiveEngine: 'upstream-unmanaged',
              reason: 'phase2-configuration-only',
              restartPending: bootRevision !== null && revision !== bootRevision,
              bootRevisionObserved: bootRevision !== null,
              globalHostOwnershipVerified: false },
          } }
        }
        if (method === 'save' && Object.keys(payload).length === 2
          && Object.hasOwn(payload, 'settings') && Object.hasOwn(payload, 'revision')) {
          const settings = writeSettings(payload.settings, payload.revision)
          const revision = settingsRevision(settings)
          return { ok: true, value: { settings, revision,
            runtime: { applied: false, effectiveEngine: 'upstream-unmanaged',
              reason: 'phase2-configuration-only',
              restartPending: bootRevision !== null && revision !== bootRevision,
              bootRevisionObserved: bootRevision !== null,
              globalHostOwnershipVerified: false } } }
        }
        if (method === 'resolve' && Object.keys(payload).length === 1 && Object.hasOwn(payload, 'target')) {
          const target = payload.target
          if (!target || typeof target !== 'object' || Array.isArray(target)
            || Object.keys(target).some(k => !['agentId','provider','model'].includes(k))) throw Error('invalid target')
          return { ok: true, value: resolvePolicy(readSettings(), target) }
        }
        if (method === 'preview' && Object.keys(payload).length === 2
          && Object.hasOwn(payload, 'contextWindow') && Object.hasOwn(payload, 'reservedOutput')) {
          return { ok: true, value: previewNative(readSettings().basic, payload) }
        }
        throw Error('unknown context manager method')
      } catch (error) {
        const message = String(error?.message ?? error)
        // Avoid returning untrusted filesystem paths or raw exceptions to Web.
        const friendly = /settings changed/.test(message) ? '配置已被其他页面修改，请刷新后保存'
          : /invalid|unsupported|missing|duplicate|ratio|retention|revision|override|policy|target|method|range/i.test(message)
            ? message.slice(0, 180) : '上下文管理配置不可用；请检查容器日志'
        return { ok: false, error: { code: 'invalid_request', message: friendly } }
      }
    })
  })
}

export default { name, inject, apply }
