/** Reverse-only live readiness marker. Auto-disposed if sessionController deactivates. */
import { writeFileSync, rmSync } from 'node:fs'
export const name = 'dsh-reverse-session-health'
export const inject = ['sessionController']
const file = '/tmp/dsh-reverse-session-ready.json'
export function apply(ctx) {
  if (typeof ctx.sessionController?.create !== 'function') {
    throw Error('sessionController.create is missing')
  }
  ctx.effect(() => {
    writeFileSync(file, JSON.stringify({ pid: process.pid, started: Date.now() }) + '\n', { mode: 0o600 })
    return () => { try { rmSync(file, { force: true }) } catch {} }
  }, 'Reverse session readiness marker')
}
export default { name, inject, apply }
