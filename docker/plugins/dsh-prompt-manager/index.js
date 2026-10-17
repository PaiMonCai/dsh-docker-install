import { readState, writeState, assemblePrompt, summary, revision } from './core.mjs'
import { permissionStatus, setPermission } from './permissions.mjs'

export const name = 'dsh-docker-prompt-manager'
export const inject = []
export const ENDPOINT = '/dsh-docker-prompt-manager'

export function apply(ctx) {
  let lastAssembly = { available: false }
  let execution = null
  let toolRuntime = null
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const original = await next()
    try {
      const cwd = context?.agent?.session?.header?.cwd || ''
      const state = readState()
      const result = assemblePrompt(original, state, cwd)
      lastAssembly = { available: true, capturedAt: Date.now(),
        ...summary(state, result.injected, cwd), workspace: result.workspace,
        note: 'Observed assembly-hook sections before final rendering; not the final model request.' }
      return result.assembly
    } catch {
      ctx.logger?.warn?.('DSH Docker Prompt Manager: invalid settings; original assembly preserved')
      lastAssembly = { available: true, capturedAt: Date.now(), injected: [], error: 'prompt injection skipped: invalid settings' }
      return original
    }
  })
  ctx.inject(['tools'], c => {
    if (typeof c.tools.guard !== 'function' || typeof c.tools.schemas !== 'function') {
      ctx.logger?.warn?.('DSH Docker Prompt Manager: current tool runtime does not support guard controls')
      return
    }
    // This monotonic guard also runs for nested PTC dispatches. Permitted calls
    // still pass every other owner's checks; it cannot override another denial.
    c.tools.guard(exec => {
      try {
        if (readState().deniedTools.includes(exec.name))
          return 'Tool disabled by DSH Docker instance policy: ' + exec.name
      } catch { return 'DSH Docker tool policy unavailable; repair prompt-manager settings before executing tools' }
    })
    toolRuntime = c.tools
    c.effect(() => () => { toolRuntime = null })
  })
  ctx.inject(['permissionPresets', 'sessions', 'agents', 'sandboxPolicy', 'approval'], c => {
    execution = c
    c.effect(() => () => { execution = null })
  })
  ctx.inject(['connection'], c => {
    // Independent channel behind standard authenticated Connection; /api is
    // reserved for upstream, otherwise core session/directory routes break.
    c.connection.rpc.handle(ENDPOINT, async (method, payload = {}) => {
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('invalid payload')
        let value
        switch (method) {
          case 'state': {
            const state = readState()
            value = { ...state, revision: revision(state), toolsAvailable: !!toolRuntime }
            break
          }
          case 'save': {
            if (typeof payload.revision !== 'string') throw Error('settings revision required')
            if (payload.deniedTools?.length && !toolRuntime) throw Error('tool runtime guard is unavailable')
            value = writeState({ ...payload, schema: 1 }, undefined, payload.revision)
            value = { ...value, revision: revision(value), toolsAvailable: !!toolRuntime }
            break
          }
          case 'inspect': value = lastAssembly; break
          case 'permissions': value = permissionStatus(execution, toolRuntime); break
          case 'permissionSet': value = setPermission(execution, payload); break
          default: throw Error('unknown prompt-manager method')
        }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: { code: 'invalid_request', message: String(error?.message ?? error) } }
      }
    })
  })
}

export default { name, inject, apply }
