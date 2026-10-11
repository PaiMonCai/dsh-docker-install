/** Process-only LRU cache; no query text is persisted on disk. */
export class SearchCache {
  constructor({ maxEntries = 500, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.entries = new Map()
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
    this.bytes = 0
  }
  get(key) {
    const found = this.entries.get(key)
    if (!found) return undefined
    if (Date.now() >= found.expiresAt) { this.delete(key); return undefined }
    this.entries.delete(key)
    this.entries.set(key, found)
    return structuredClone(found.value)
  }
  set(key, value, ttlMs) {
    if (!ttlMs || ttlMs < 1) return
    const bytes = Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value))
    if (bytes > this.maxBytes) return
    this.delete(key)
    this.entries.set(key, { value: structuredClone(value), bytes, expiresAt: Date.now() + ttlMs })
    this.bytes += bytes
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.delete(this.entries.keys().next().value)
    }
  }
  delete(key) {
    const found = this.entries.get(key)
    if (found) { this.bytes -= found.bytes; this.entries.delete(key) }
  }
}
