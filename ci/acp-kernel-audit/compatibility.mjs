import { cp, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
export const { Session, SessionId, appendPluginRecord } = await import(
  pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
export const repo = resolve(import.meta.dirname, '../..')
export const fixturePath = resolve(repo, 'tests/fixtures/context-manager/acp-0.0.101-session.json')
export const baselineRoot = resolve(import.meta.dirname, 'node_modules/acp-kernel')

export async function loadAdapter(kernelRoot, directory) {
  const plugin = resolve(directory, 'plugin')
  await mkdir(plugin, { recursive: true })
  for (const name of ['acp-runtime.mjs', 'acp-pending.mjs', 'acp-recovery.mjs',
    'acp-ccr.mjs', 'content-store-port.mjs', 'history-index.mjs']) {
    await cp(resolve(repo, 'docker/plugins/dsh-context-manager', name), resolve(plugin, name))
  }
  const target = resolve(plugin, 'node_modules/acp-kernel')
  await mkdir(target, { recursive: true })
  await cp(resolve(kernelRoot, 'dist'), resolve(target, 'dist'), { recursive: true })
  await cp(resolve(kernelRoot, 'package.json'), resolve(target, 'package.json'))
  const load = name => import(pathToFileURL(resolve(plugin, name)).href)
  return { ...await load('acp-runtime.mjs'), ...await load('acp-pending.mjs'),
    ...await load('acp-ccr.mjs'), ...await load('acp-recovery.mjs') }
}

export { transaction } from '../../tests/lib/context-manager-legacy-probe.mjs'

export async function readFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'))
}

export async function probeLegacySession(adapter, fixture) {
  const { probeLegacySession: probe } = await import('../../tests/lib/context-manager-legacy-probe.mjs')
  return probe(adapter, fixture, { Session, SessionId, appendPluginRecord })
}

export async function probeTieredAdapter(adapter) {
  const { probeTieredAdapter: probe } = await import('../../tests/lib/context-manager-legacy-probe.mjs')
  return probe(adapter, { Session, SessionId, appendPluginRecord })
}
