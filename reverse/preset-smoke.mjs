/** Inert except when explicitly enabled by Reverse CI smoke test. */
export const name = 'dsh-reverse-preset-smoke'
export const inject = ['agentPresets']
export function apply(ctx) {
  if (process.env.DSH_REVERSE_CI_VERIFY_PRESET !== '1') return
  ctx.effect(() => {
    let stopped = false
    let attempts = 0
    const check = async () => {
      if (stopped) return
      const rows = await ctx.agentPresets.list()
      const preset = rows?.find(p => p.id === 'reverse-engineering')
      if (preset && !preset.broken) {
        stopped = true
        clearInterval(interval)
        process.stdout.write('DSH_REVERSE_CI_PRESET_REGISTERED\n')
      } else if (++attempts >= 20) {
        stopped = true
        clearInterval(interval)
        process.stderr.write('DSH_REVERSE_CI_PRESET_MISSING_OR_BROKEN\n')
      }
    }
    const interval = setInterval(() => void check().catch(err => {
      stopped = true
      clearInterval(interval)
      process.stderr.write('DSH_REVERSE_CI_PRESET_ERROR ' + String(err) + '\n')
    }), 500)
    interval.unref?.()
    return () => { stopped = true; clearInterval(interval) }
  }, 'Verify native Reverse preset')
}
export default { name, inject, apply }
