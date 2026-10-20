import { makeProbe } from './core.mjs'
import { inspectRuntimePresets } from './native-inventory.mjs'
import { defaults, normalizeSettings, resolvePolicy, previewNative } from './policy.mjs'
import { readSettings, writeSettings, settingsRevision } from './storage.mjs'
import { indexCompactions, publicIndex, summaryDetail, originalPage } from './history-index.mjs'
import { installReplaySmoke } from './ci-replay.mjs'
import { auditOwnership } from './ownership-audit.mjs'
import { createTakeoverPolicy, isPresetEntry, replacePresetCompactor, GATE } from './takeover.mjs'

export const name = 'dsh-docker-context-manager'
export const inject = []
export const ENDPOINT = '/dsh-docker-context-manager'

/**
 * Phase 2: read-only native compaction observer with durable policy intentions.
 * No policy is applied to a live compaction service until ownership is verified.
 */
export function apply(ctx) {
  const takeover = createTakeoverPolicy()
  let takeoverEvidence = null
  const probe = makeProbe()
  // Inert unless a disposable CI container explicitly enables the replay
  // smoke; never writes real user sessions or enables live compaction.
  installReplaySmoke(ctx)
  // This RPC channel lacks DSH's per-Peer Typert resource guards; never expose
  // Session content by default. A single-owner deployment can explicitly opt in.
  const historyEnabled = process.env.DSH_CONTEXT_MANAGER_HISTORY_READ === 'owner-only'
  // The boot revision is evidence of what this *plugin* read, NOT proof that an
  // upstream compactor loaded these values. Do not claim a configuration is live.
  let bootRevision = null
  try { bootRevision = settingsRevision(readSettings()) }
  catch { ctx.logger?.warn?.('Context Manager settings unavailable at boot; native compaction unchanged') }
  ctx.on('internal/config', function (_raw, next) {
    const resolved = next()
    const transformed = takeover.active && isPresetEntry(this?.entry)
      ? replacePresetCompactor(resolved,takeover.settings,takeover.target) : {changed:false,config:resolved}
    if(transformed.changed) takeoverEvidence=transformed.evidence
    try { probe.observeConfig(this?.entry, transformed.config) }
    catch (error) { ctx.logger?.warn?.('context-manager preset probe failed: ' + String(error?.message || error)) }
    return transformed.config
  }, { global: true })
  // Gate selected preset until this middleware is registered. No service
  // exists in default deployment, and this does not insert a compactor.
  if(takeover.active) {
    if(typeof ctx.reflect?.provide!=='function')
      throw Error('native preset gate unavailable; refusing tiered activation')
    ctx.reflect.provide(GATE,true)
  }

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
        if (method === 'history-capabilities' && Object.keys(payload).length === 0) {
          return { ok: true, value: { enabled: historyEnabled, mode: historyEnabled
            ? 'operator-opt-in-owner-only' : 'disabled', durableSource: 'native-session-log' } }
        }
        if (typeof method === 'string' && method.startsWith('history-')) {
          if (!historyEnabled) return { ok: false, error: {
            code: 'history_disabled', message: '原文读取未启用；仅限单用户管理部署显式开启' } }
          const controller = ctx.get?.('sessionController')
          if (!controller || typeof controller.inspect !== 'function')
            return { ok:false, error:{code:'unavailable',message:'DSH 原生 Session 读取服务不可用'} }
          if (method === 'history-sessions' && Object.keys(payload).length === 0) {
            if (typeof controller.list !== 'function')
              throw Error('history sessions list unavailable')
            const result = await controller.list({}, new AbortController().signal)
            return { ok:true, value:{
              items:(result?.items??[]).slice(0,50).map(item=>({
                sessionId:item.sessionId,updatedAt:item.updatedAt??null,
                agentPreset:item.agentPreset??null,running:!!item.running,
              })),
              truncated:(result?.items?.length??0)>50,
            } }
          }
          const sessionId=payload.sessionId
          if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(sessionId))
            throw Error('invalid sessionId')
          const knownKeys={
            'history-index':['sessionId','offset','limit','query'],
            'history-summary':['sessionId','summarySeq'],
            'history-originals':['sessionId','summarySeq','revision','offset','limit'],
          }
          if (!Object.hasOwn(knownKeys, method)
            || Object.keys(payload).some(k=>!knownKeys[method].includes(k)))
            throw Error('invalid history request')
          // Single snapshot per request: native inspect handles both attached
          // and cold persisted sessions without activation or mutation.
          const inspected=await controller.inspect(sessionId)
          if (!inspected || inspected.meta?.id!==sessionId)
            throw Error('history inspection unavailable')
          const indexed=indexCompactions(inspected)
          if (method==='history-index')
            return {ok:true,value:publicIndex(indexed,{
              offset:payload.offset??0,limit:payload.limit??20,query:payload.query??'',
            })}
          if (method==='history-summary')
            return {ok:true,value:summaryDetail(indexed,payload.summarySeq)}
          if (method==='history-originals')
            return {ok:true,value:originalPage(inspected,indexed,{
              summarySeq:payload.summarySeq,offset:payload.offset??0,
              limit:payload.limit??5,revision:payload.revision,
            })}
        }
        if (method === 'status' && Object.keys(payload).length === 0) {
          const nativePresets = await inspectRuntimePresets(ctx)
          return { ok: true, value: { ...probe.snapshot(ctx), nativePresets,
            ownerAudit: auditOwnership(nativePresets, probe.snapshot(ctx).hostCompaction),
            tieredTakeover: takeover.active ? {mode:'lab-only', changed:!!takeoverEvidence, preset:'standard'} : {mode:'disabled'} } }
        }
        if (method === 'settings' && Object.keys(payload).length === 0) {
          const settings = readSettings()
          const revision = settingsRevision(settings)
          const nativePresets = await inspectRuntimePresets(ctx)
          return { ok: true, value: {
            settings, revision, nativePresets, events: probe.snapshot(ctx).events,
            ownerAudit: auditOwnership(nativePresets, probe.snapshot(ctx).hostCompaction),
            tieredTakeover: takeover.active ? {mode:'lab-only', changed:!!takeoverEvidence, preset:'standard'} : {mode:'disabled'},
            runtime: { applied: false, effectiveEngine: 'upstream-unmanaged',
              reason: takeover.active ? 'single-preset-lab-attempt; ownership-not-certified' : 'configuration-only',
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
              reason: takeover.active ? 'single-preset-lab-attempt; ownership-not-certified' : 'configuration-only',
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
          : /invalid|unsupported|missing|duplicate|ratio|retention|revision|override|policy|target|method|range|history changed/i.test(message)
            ? message.slice(0, 180) : '上下文管理配置不可用；请检查容器日志'
        return { ok: false, error: { code: 'invalid_request', message: friendly } }
      }
    })
  })
}

export default { name, inject, apply }
