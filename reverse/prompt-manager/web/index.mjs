/** Reverse Prompt Manager Web settings: loopback-only RPC, no standalone admin HTTP server. */
import { listPresets, loadPreset, readState, writeState, importPreset,
  removePreset, saveSectionPreset, listVersions, restoreVersion } from '../core.mjs'
import { getSnapshot, clearCapture, requestCapture } from '../inspect.mjs'
import { readHook, writeHook } from '../hook-guidance.mjs'
import { projects, project, createProject } from './projects.mjs'
import { projectLinks, attachProjectItem } from './project-links.mjs'
import { createProjectTask, reconcileProjectResults, recoverProjectTasks, inspectOrphanTasks } from './project-tasks.mjs'
import { runProjectTask } from './task-runner.mjs'
import { tasks as workbenchTasks, taskDetail, report as workbenchReport, manifest as workbenchManifest } from './workbench.mjs'

export const name = 'dsh-reverse-prompt-web'
export const inject = []
const METHODS = new Set(['state','list','get','activate','disable','save','remove',
  'history','rollback','hookGet','hookSave','inspect','captureRequest','captureShow','captureClear',
  'workbenchTasks','workbenchTaskDetail','workbenchReport','workbenchManifest',
  'workbenchProjects','workbenchProject','workbenchProjectCreate',
  'workbenchProjectLinks','workbenchProjectAttach','workbenchProjectTaskCreate','workbenchProjectResultsSync','workbenchProjectRunOnce'])
const assertName = name => {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(name))
    throw Error('invalid preset name')
  return name
}
export function command(method, payload = {}) {
  if (!METHODS.has(method)) throw Error('unknown prompt-manager method')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw Error('invalid payload')
  switch (method) {
    case 'workbenchProjectRunOnce': return runProjectTask(payload.id,payload.taskId,payload.confirmation)
    case 'workbenchOrphanTasks': return inspectOrphanTasks()
    case 'workbenchProjectTasksRecover': return recoverProjectTasks(payload.id)
    case 'workbenchProjectResultsSync': return reconcileProjectResults(payload.id)
    case 'workbenchProjectTaskCreate': return createProjectTask(payload.id,payload.kind,payload.inputs)
    case 'workbenchProjectLinks': return projectLinks(payload.id)
    case 'workbenchProjectAttach': return attachProjectItem(payload.id,payload.kind,payload.ref)
    case 'workbenchProjects': return projects()
    case 'workbenchProject': return project(payload.id)
    case 'workbenchProjectCreate': return createProject(payload.name, payload.description || '')
    case 'workbenchManifest': return workbenchManifest(payload.path)
    case 'workbenchTasks': return workbenchTasks()
    case 'workbenchTaskDetail': return taskDetail(payload.id)
    case 'workbenchReport': return workbenchReport(payload.path)
    case 'hookGet': return readHook()
    case 'hookSave': return writeHook({enabled:payload.enabled,text:payload.text})
    case 'state': return readState()
    case 'list': return listPresets().map(name => {
      const p = loadPreset(name)
      return { name, title: p.title, mode: p.mode,
        builtin: ['evidence','concise','architecture'].includes(name) }
    })
    case 'get': return loadPreset(assertName(payload.name))
    case 'activate': return writeState({ schema: 1, enabled: true, active: assertName(payload.name) })
    case 'disable': return writeState({ ...readState(), enabled: false })
    case 'save': {
      const name = assertName(payload.name)
      if (payload.mode === 'sections') {
        return saveSectionPreset(name, payload.rules, undefined,
          typeof payload.title === 'string' ? payload.title : name)
      }
      // Prevent accidental overwrite of built-in and section presets.
      if (payload.mode !== 'append' && payload.mode !== 'replace-persona')
        throw Error('invalid mode')
      return importPreset(name, payload.text, undefined, payload.mode)
    }
    case 'remove': removePreset(assertName(payload.name)); return { removed: payload.name }
    case 'history': return listVersions(assertName(payload.name))
    case 'rollback': {
      if (typeof payload.revision !== 'string') throw Error('revision required')
      return restoreVersion(assertName(payload.name), payload.revision)
    }
    case 'inspect': return getSnapshot()
    case 'captureRequest': return requestCapture()
    case 'captureShow': return getSnapshot(undefined, true)
    case 'captureClear': return clearCapture()
  }
}
export function apply(ctx) {
  // An independent authenticated RPC channel is mandatory: /api allows exactly
  // one interceptor, which belongs to upstream dsh-api-gateway. Claiming it
  // here can leave all built-in session/model/directory APIs returning 404.
  ctx.inject(['connection'], c => {
    c.connection.rpc.handle('/reverse-prompt', async (endpoint, payload) => {
      try {
        return { ok: true, value: await command(endpoint, payload) }
      } catch (error) {
        return { ok: false, error: { code: 'invalid_request',
          message: String(error?.message ?? error) } }
      }
    })
  })
}
export default { name, inject, apply }
