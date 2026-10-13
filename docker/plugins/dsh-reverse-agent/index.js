/**
 * Image-native REA Agent preset.
 *
 * The pinned dsh-purge snapshot supplies the preset, its Skill and its scoped
 * notebook/tools; this glue remaps the private tool module to a file URL so no
 * dsh plugin install, pnpm or global node_modules resolution is necessary.
 * Do NOT import dsh-purge's root plugin: it patches other Agent modes.
 */
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { readPresetDefinition } from './vendor/lib/redteam/preset-composition.js'
import { PRESET_ID, prepareReverseAssets } from './vendor/lib/reverse/index.js'

export const name = 'dsh-docker-reverse-agent'
export const inject = []

const PRESET_DIR = dirname(fileURLToPath(new URL('./vendor/presets/reverse-engineering/preset.yml', import.meta.url)))
const TOOLS_URL = new URL('./vendor/lib/reverse/tools.js', import.meta.url).href

export function reverseDefinition() {
  const definition = readPresetDefinition(PRESET_ID, PRESET_DIR)
  const tools = definition.plugins.filter(item => item.id === 'reverse-workflow-tools')
  if (tools.length !== 1 || tools[0].name !== 'dsh-purge/reverse/tools') {
    throw new Error('Pinned dsh-purge preset tool declaration changed; review this image integration')
  }
  tools[0].name = TOOLS_URL
  const mcp = definition.plugins.find(item => item.id === 'rea-mcp')
  if (mcp?.config?.command !== 'rea' || mcp?.config?.args?.length !== 1 || mcp.config.args[0] !== 'mcp') {
    throw new Error('Pinned REA MCP contract changed; review image integration')
  }
  return definition
}

export function apply(ctx) {
  // Safe and idempotent; modifies only a missing/unmodified bundled Skill in
  // $DSH_HOME, preserving custom user edits and all unrelated profiles.
  try {
    prepareReverseAssets()
  } catch (error) {
    ctx.logger?.warn?.('bundled reverse Skill unavailable: %s', error?.message || String(error))
    return
  }
  ctx.effect(() => {
    let closed = false
    let running = false
    let unregister = null
    const registryOf = () => {
      try { if (ctx.agentPresets?.register) return ctx.agentPresets } catch { /* optional */ }
      try {
        const service = ctx.get?.('agentPresets')
        return service?.register ? service : null
      } catch { return null }
    }
    const poll = async () => {
      if (closed || running) return
      const registry = registryOf()
      if (!registry) return
      running = true
      clearInterval(timer)
      clearTimeout(deadline)
      try {
        // A user-installed copy might already declare the same preset; keep it.
        if ((await registry.list()).some(x => x.id === PRESET_ID)) {
          ctx.logger?.info?.('reverse-engineering preset already present; preserving existing registration')
          return
        }
        const dispose = await registry.register(reverseDefinition())
        if (closed) { await dispose(); return }
        unregister = dispose
        const row = (await registry.list()).find(x => x.id === PRESET_ID)
        if (row?.broken) ctx.logger?.warn?.('image-bundled REA preset has errors: %s', row.broken)
        else ctx.logger?.info?.('image-bundled REA preset ready')
      } catch (error) {
        ctx.logger?.warn?.('image-bundled REA preset registration failed: %s', error?.message || String(error))
      }
    }
    const timer = setInterval(() => { void poll() }, 500)
    timer.unref?.()
    const deadline = setTimeout(() => {
      clearInterval(timer)
      if (!closed && !running) ctx.logger?.warn?.('reverse-engineering: Agent preset registry unavailable')
    }, 45000)
    deadline.unref?.()
    void poll()
    return () => {
      closed = true
      clearInterval(timer)
      clearTimeout(deadline)
      if (unregister) void Promise.resolve(unregister()).catch(error => {
        ctx.logger?.warn?.('reverse-engineering preset disposal failed: %s', error?.message || String(error))
      })
    }
  }, 'dsh-docker-reverse-agent: register preset')
}
export default { name, inject, apply }
