/**
 * Persistent conservative paid-fallback budget. Stores a UTC date and count,
 * NEVER the API key or a search query. Serial within one DSH process.
 */
import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class BraveBudget {
  constructor({ path, dailyLimit = 50 }) {
    if (!path) throw new Error('budget path required')
    this.path = path
    this.dailyLimit = Number.isInteger(dailyLimit) && dailyLimit >= 0 ? dailyLimit : 50
    this.queue = Promise.resolve()
  }
  async reserve() {
    const attempt = this.queue.catch(() => {}).then(async () => {
      if (this.dailyLimit === 0) return false
      const today = new Date().toISOString().slice(0, 10)
      let state = { day: today, count: 0 }
      const kind = await lstat(this.path).catch(e => e.code === 'ENOENT' ? null : Promise.reject(e))
      if (kind && (!kind.isFile() || kind.isSymbolicLink())) {
        throw new Error('unsafe Brave budget file')
      }
      if (kind) {
        try {
          const saved = JSON.parse(await readFile(this.path, 'utf8'))
          if (saved.day === today && Number.isSafeInteger(saved.count) && saved.count >= 0) {
            state = saved
          }
        } catch {
          // Deny rather than reset a corrupt budget into a free paid quota.
          throw new Error('Brave budget state is unreadable; fallback disabled')
        }
      }
      if (state.count >= this.dailyLimit) return false
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const tmp = this.path + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(tmp, JSON.stringify({ day: today, count: state.count + 1 }) + '\n', { mode: 0o600, flag: 'wx' })
        await rename(tmp, this.path)
      } finally { await rm(tmp, { force: true }).catch(() => {}) }
      return true
    })
    this.queue = attempt.then(() => undefined, () => undefined)
    return attempt
  }
}
