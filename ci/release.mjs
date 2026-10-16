#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Registry, ContractError, label, validateStandard } from './registry.mjs'
import { compareVersions } from './semver-max.mjs'

export const paths = JSON.parse(readFileSync(new URL('./release-paths.json', import.meta.url), 'utf8'))
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
export function sourceTree(edition, revision = 'HEAD') {
  if (!paths[edition]) throw new Error('Unknown edition: ' + edition)
  let tree = git('ls-tree', '-r', revision, '--', ...paths[edition])
  if (edition === 'standard') {
    // The updater records the successfully built version afterwards. Its
    // version-only commit must not look like a new Standard implementation.
    for (const path of ['Dockerfile', 'docker-compose.yml']) {
      const text = git('show', revision + ':' + path)
        .replace(/^ARG DSH_VERSION=\S+$/m, 'ARG DSH_VERSION=<release>')
        .replace(/^(\s*DSH_VERSION:)\s*["']?[\w.+-]+["']?\s*$/m, '$1 <release>')
      const hash = createHash('sha256').update(text).digest('hex')
      tree = tree.replace(new RegExp(' [a-f0-9]+\\t' + path.replaceAll('.', '\\.') + '$', 'm'), ' ' + hash + '\t' + path)
    }
  }
  return createHash('sha256').update(tree).digest('hex')
}
export function needsStandard(artifact, version, tree) {
  try {
    const release = validateStandard(artifact)
    return release.version !== version || release.tree !== tree
  } catch (error) {
    if (!(error instanceof ContractError)) throw error
    return true
  }
}
export function needsDerivative(artifact, edition, standard, tree) {
  return !artifact || artifact.labels[label.edition] !== edition
    || artifact.labels[label.base] !== standard.digest
    || artifact.labels[label.version] !== standard.version
    || artifact.labels[label.tree] !== tree
}
export function mayPromote({ edition, tree, currentTree, version, desiredVersion, base, currentStandard }) {
  if (tree !== currentTree) return false
  if (edition !== 'standard') return !!currentStandard && base === currentStandard.digest
  if (compareVersions(version, desiredVersion) < 0) return false
  return !currentStandard || compareVersions(version, currentStandard.version) >= 0
}
function output(values) {
  for (const [key, value] of Object.entries(values)) {
    const text = String(value)
    if (/[\r\n]/.test(text)) throw new Error('Invalid multiline release output: ' + key)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${text}\n`)
    console.log(`${key}=${text}`)
  }
}
function env(name) {
  const value = process.env[name]
  if (!value) throw new Error('Missing ' + name)
  return value
}
async function existing(registry, reference) {
  try {
    return await registry.inspect(reference, { missingOK: true })
  } catch (error) {
    // Old images predate the contract. Authentication and transport failures
    // must still fail the check, rather than masquerading as missing releases.
    if (!(error instanceof ContractError)) throw error
    console.warn(error.message)
    return null
  }
}
function standardOutputs(standard) {
  return { base_image: standard.image, digest: standard.digest, version: standard.version,
    source_sha: standard.source, channels: standard.channels }
}
export async function main(command, edition, { registry: injectedRegistry, execute = execFileSync } = {}) {
  if (command === 'paths') {
    if (!paths[edition]) throw new Error('Unknown edition')
    console.log(paths[edition].join('\n'))
    return
  }
  if (command === 'tree') {
    output({ tree: sourceTree(edition) })
    return
  }
  const image = env('RELEASE_IMAGE').toLowerCase()
  const registry = injectedRegistry || new Registry(image)
  if (command === 'resolve') {
    const version = process.env.REQUESTED_VERSION || ''
    const reference = process.env.REQUESTED_BASE || `${image}:${version || 'latest'}`
    const standard = validateStandard(await registry.inspect(reference),
      { version, source: process.env.REQUESTED_SOURCE_SHA || '' })
    if (process.env.REQUESTED_CHANNELS && process.env.REQUESTED_CHANNELS !== standard.channels) {
      throw new ContractError('Requested channels disagree with the Standard release')
    }
    output(standardOutputs(standard))
    const ready = standard.tree === sourceTree('standard')
    output({ ready })
    if (!ready) console.log('Waiting for Standard to publish the base changes in this checkout.')
    return
  }
  if (command === 'plan') {
    const artifact = await existing(registry, image + ':latest')
    const build = needsStandard(artifact, env('TARGET_VERSION'), sourceTree('standard'))
    output({ build })
    if (!build) output(standardOutputs(validateStandard(artifact)))
    return
  }
  if (command === 'verify') {
    const standard = validateStandard(await registry.inspect(image + ':latest'), { version: env('TARGET_VERSION') })
    if (standard.tree !== sourceTree('standard')) throw new ContractError('Published Standard does not match current source')
    return
  }
  if (command === 'reconcile') {
    const standard = validateStandard(await registry.inspect(image + ':latest'))
    output(standardOutputs(standard))
    if (standard.tree !== sourceTree('standard')) {
      output({ research: false, reverse: false })
      console.log('Current Standard source has not been published yet; defer derivative dispatch.')
      return
    }
    for (const name of ['research', 'reverse']) {
      const targets = name === 'research' ? ['research', 'research-economics'] : ['reverse']
      let needed = false
      for (const target of targets) {
        const artifact = await existing(registry, image + ':' + target)
        needed ||= needsDerivative(artifact, target, standard, sourceTree(name))
      }
      output({ [name]: needed })
    }
    return
  }
  if (command === 'promote') {
    if (!paths[edition]) throw new Error('Unknown edition')
    const targets = edition === 'research' ? ['research', 'research-economics'] : [edition]
    const artifacts = []
    const suffix = env('CANDIDATE_SUFFIX')
    if (!/^\d+-\d+$/.test(suffix)) throw new Error('Invalid candidate run/attempt')
    for (const target of targets) {
      const candidate = `${image}:candidate-${target}-${suffix}`
      const artifact = await registry.inspect(candidate)
      if (artifact.labels[label.edition] !== target) throw new ContractError('Candidate edition mismatch')
      artifacts.push(artifact)
    }
    // All editions share the promotion job's concurrency lock. Fetch inside
    // that lock: a queued build may have become stale while it was waiting.
    git('fetch', '--no-tags', 'origin', 'main')
    const tree = sourceTree(edition)
    const currentTree = sourceTree(edition, 'origin/main')
    const desiredVersion = git('show', 'origin/main:Dockerfile').match(/^ARG DSH_VERSION=(\S+)$/m)?.[1]
    if (!desiredVersion) throw new Error('Cannot read current main DSH version')
    let currentStandard = null
    const published = await existing(registry, image + ':latest')
    if (published) {
      try { currentStandard = validateStandard(published) } catch (error) {
        if (!(error instanceof ContractError)) throw error
      }
    }
    const version = artifacts[0].labels[label.version]
    const base = artifacts[0].labels[label.base]
    for (const artifact of artifacts) {
      if (artifact.labels[label.tree] !== tree || artifact.labels[label.version] !== version
        || artifact.labels[label.base] !== base) throw new ContractError('Candidate release labels disagree')
    }
    if (edition === 'standard') validateStandard(artifacts[0])
    if (!mayPromote({ edition, tree, currentTree, version, desiredVersion, base, currentStandard })) {
      output({ promoted: false })
      console.log('Candidate is stale; scheduled reconciliation will use current source and Standard.')
      return
    }
    const channels = artifacts[0].labels[label.channels] || ''
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      const args = ['ci/image-tags.sh', image, version, channels]
      if (target !== 'standard') args.push('--prefix', target + '-', '--no-latest')
      const tags = execute('bash', args, {
        encoding: 'utf8', env: { ...process.env, DSH_CHANNELS_RESOLVED: '1' },
      }).trim().split(/\r?\n/)
      if (target !== 'standard') tags.push(image + ':' + target)
      execute('docker', ['buildx', 'imagetools', 'create',
        ...tags.flatMap(tag => ['--tag', tag]), artifacts[i].image], { stdio: 'inherit' })
    }
    output({ promoted: true })
    if (edition === 'standard') output(standardOutputs(validateStandard(artifacts[0])))
    return
  }
  throw new Error('Unknown release command: ' + command)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
