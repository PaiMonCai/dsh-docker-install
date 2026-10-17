/** CI-only real session/create smoke test for both native Reverse presets. */
export const name = 'dsh-reverse-preset-smoke'
export const inject = ['agentPresets', 'sessionController']
const PRESETS = ['reverse-engineering', 'reverse-report-reader']

export async function verifyPresets(ctx) {
  const rows = await ctx.agentPresets.list()
  if (PRESETS.some(id => !rows?.some(row => row.id === id && !row.broken))) return false
  for (const id of PRESETS) {
    const session = await ctx.sessionController.create({
      cwd: process.cwd(),
      agentPreset: id,
    })
    if (typeof session?.sessionId !== 'string' || !session.sessionId) {
      throw Error(id + ': session controller returned an invalid session id')
    }
  }
  return true
}

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
        if (!await verifyPresets(ctx)) {
          if (++attempts >= 50) throw Error('Reverse engineering or report reader preset is missing or broken')
          return
        }
        process.stdout.write('DSH_REVERSE_CI_PRESET_REGISTERED\n')
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
  }, 'CI smoke actual reverse engineering and report reader session/create')
}
export default { name, inject, apply }
