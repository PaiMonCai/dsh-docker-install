/** Reverse-only system prompt assembly listener: never alters other Agents. */
import { applyPreset, readActive } from './core.mjs'
export const name = 'dsh-reverse-prompt-manager'
export const inject = ['agentPresets']
export function apply(ctx) {
  let lastWarning = ''
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const original = await next()
    if (!context?.agent) return original
    let presetId
    try { presetId = ctx.agentPresets.composedPreset(context.agent.ctx) }
    catch { return original }
    if (presetId !== 'reverse-engineering') return original
    try {
      const { preset } = readActive()
      if (!preset) return original
      const modified = applyPreset(original.sections, preset)
      if (!modified.changed) {
        if (modified.reason !== lastWarning) {
          lastWarning = modified.reason
          ctx.logger?.warn?.('Reverse Prompt Manager: %s; retaining original prompt', modified.reason)
        }
        return original
      }
      lastWarning = ''
      return { ...original, sections: modified.sections }
    } catch (error) {
      const warning = String(error?.message ?? error)
      if (warning !== lastWarning) {
        lastWarning = warning
        ctx.logger?.warn?.('Reverse Prompt Manager: %s; retaining original prompt', warning)
      }
      return original
    }
  })
}
export default { name, inject, apply }
