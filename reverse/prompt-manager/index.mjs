/** Scoped Reverse Prompt Manager; real assembly metadata and opt-in one-shot inspection. */
import { applyPreset, readActive } from './core.mjs'
import { recordAssembly } from './inspect.mjs'
import { readHook, applyHook } from './hook-guidance.mjs'
export const name = 'dsh-reverse-prompt-manager'
export const inject = ['agentPresets']
export function apply(ctx) {
  let lastWarning = ''
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const original = await next()
    const agent = context?.agent
    if (!agent) return original
    let agentId
    try { agentId = ctx.agentPresets.composedPreset(agent.ctx) }
    catch { return original }
    if (agentId !== 'reverse-engineering') return original

    let applied = original
    const details = { enabled: false, injected: false, preset: null, reason: null }
    try {
      const { state, preset } = readActive()
      details.enabled = state.enabled
      details.preset = preset?.name ?? null
      if (preset) {
        const transformed = applyPreset(original.sections, preset)
        if (transformed.changed) {
          applied = { ...original, sections: transformed.sections }
          details.injected = true
          lastWarning = ''
        } else {
          details.reason = transformed.reason
          if (lastWarning !== transformed.reason) {
            lastWarning = transformed.reason
            ctx.logger?.warn?.('Reverse Prompt Manager: %s; original preserved', transformed.reason)
          }
        }
      }
    } catch (error) {
      const msg = String(error?.message ?? error)
      details.reason = 'invalid preset or state'
      if (lastWarning !== msg) {
        lastWarning = msg
        ctx.logger?.warn?.('Reverse Prompt Manager: %s; original preserved', msg)
      }
    }
    try {
      const hook = applyHook(applied.sections, readHook())
      if (hook.changed) { applied = { ...applied, sections: hook.sections }; details.injected = true; details.hookInjected = true }
    } catch (error) {
      ctx.logger?.warn?.('Reverse Hook Guidance: %s; hook skipped', String(error?.message ?? error))
    }
    // Diagnostic persistence must NEVER interrupt model requests.
    try { recordAssembly(original, applied, details) }
    catch (error) {
      ctx.logger?.warn?.('Reverse Prompt Manager diagnostic write unavailable: %s',
        String(error?.message ?? error))
    }
    return applied
  })
}
export default { name, inject, apply }
