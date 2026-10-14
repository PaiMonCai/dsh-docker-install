/** CI-only real session/create smoke test for the native Reverse preset. */
export const name = 'dsh-reverse-preset-smoke'
export const inject = ['agentPresets', 'sessionController']
export function apply(ctx) {
  if (process.env.DSH_REVERSE_CI_VERIFY_PRESET !== '1') return
  ctx.effect(() => {
    let stopped = false
    let checking = false
    let attempts = 0
    const check = async () => {
      if (stopped || checking) return
      checking = true
      try {
        const rows = await ctx.agentPresets.list()
        const preset = rows?.find(p => p.id === 'reverse-engineering')
        if (!preset || preset.broken) {
          if (++attempts >= 50) throw Error('Reverse preset is missing or broken')
          return
        }
        process.stdout.write('DSH_REVERSE_CI_PRESET_REGISTERED\n')
        const session = await ctx.sessionController.create({
          cwd: process.cwd(),
          agentPreset: 'reverse-engineering',
        })
        if (typeof session?.sessionId !== 'string' || !session.sessionId) {
          throw Error('Session controller returned an invalid session id')
        }
        stopped = true
        clearInterval(interval)
        process.stdout.write('DSH_REVERSE_CI_SESSION_CREATED\n')
      } catch (error) {
        stopped = true
        clearInterval(interval)
        process.stderr.write('DSH_REVERSE_CI_SESSION_FAILED ' + String(error) + '\n')
      } finally {
        checking = false
      }
    }
    const interval = setInterval(() => void check(), 500)
    interval.unref?.()
    void check()
    return () => { stopped = true; clearInterval(interval) }
  }, 'CI smoke actual reverse session/create')
}
export default { name, inject, apply }
