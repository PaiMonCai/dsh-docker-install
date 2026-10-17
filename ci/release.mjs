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
export function publication(ref = process.env.GITHUB_REF || '') {
  if (!ref.startsWith('refs/tags/')) {
    return { track: 'dev', release_tag: '', release_version: '', standard_tag: 'dev' }
  }
  const tag = ref.slice('refs/tags/'.length)
  const identifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
  const semverTag = new RegExp('^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-' + identifier + '(?:\\.' + identifier + ')*)?$')
  if (!semverTag.test(tag) || tag.length > 90)
    throw new ContractError('Release tags must use v<SemVer>, for example v1.2.3 or v1.2.3-rc.1')
  const version = tag.slice(1)
  compareVersions(version, version)
  return { track: 'release', release_tag: tag, release_version: version, standard_tag: version }
}
function assertPublication(artifact, policy) {
  if (!artifact || artifact.labels[label.track] !== policy.track ||
      (artifact.labels[label.releaseTag] || '') !== policy.release_tag)
    throw new ContractError('Image publication track or Git release tag mismatch')
}
export function publicationTags(image, target, policy, { suffix, source, floating = true } = {}) {
  const prefix = target === 'standard' ? '' : target + '-'
  if (policy.track === 'dev') {
    if (!/^[a-f0-9]{40}$/.test(source || '') || !/^\d+-\d+$/.test(suffix || ''))
      throw new ContractError('Development tags require source SHA and build run/attempt')
    return [`${image}:${prefix}dev-${source.slice(0, 12)}-${suffix}`, `${image}:${prefix}dev`]
  }
  return [`${image}:${prefix}${policy.release_version}`,
    ...(floating ? [`${image}:${target === 'standard' ? 'latest' : target}`] : [])]
}
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
    || (artifact.labels[label.track] || '') !== standard.track
    || (artifact.labels[label.releaseTag] || '') !== standard.releaseTag
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
    source_sha: standard.source, channels: standard.channels,
    track: standard.track, release_tag: standard.releaseTag }
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
  const policy = publication()
  if (command === 'publication') {
    output(policy)
    return
  }
  const image = env('RELEASE_IMAGE').toLowerCase()
  const registry = injectedRegistry || new Registry(image)
  if (command === 'resolve') {
    const version = process.env.REQUESTED_VERSION || ''
    const reference = process.env.REQUESTED_BASE || `${image}:${policy.standard_tag}`
    const artifact = await registry.inspect(reference)
    assertPublication(artifact, policy)
    const standard = validateStandard(artifact,
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
    const artifact = await existing(registry, image + ':' + policy.standard_tag)
    const build = needsStandard(artifact, env('TARGET_VERSION'), sourceTree('standard'))
      || artifact.labels[label.track] !== policy.track || (artifact.labels[label.releaseTag] || '') !== policy.release_tag
    output({ build })
    if (!build) output(standardOutputs(validateStandard(artifact)))
    return
  }
  if (command === 'verify') {
    const artifact = await registry.inspect(image + ':' + policy.standard_tag)
    assertPublication(artifact, policy)
    const standard = validateStandard(artifact, { version: env('TARGET_VERSION') })
    if (standard.tree !== sourceTree('standard')) throw new ContractError('Published Standard does not match current source')
    return
  }
  if (command === 'reconcile') {
    const baseArtifact = await registry.inspect(image + ':' + policy.standard_tag)
    assertPublication(baseArtifact, policy)
    const standard = validateStandard(baseArtifact)
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
        const artifact = await existing(registry, image + ':' + target + (policy.track === 'dev' ? '-dev' : '-' + policy.release_version))
        needed ||= needsDerivative(artifact, target, standard, sourceTree(name))
      }
      output({ [name]: needed })
    }
    return
  }
  if (command === 'promote') {
    if (!paths[edition]) throw new Error('Unknown edition')
    if (policy.track === 'dev' && process.env.GITHUB_REF !== 'refs/heads/main')
      throw new ContractError('Development publication requires the main branch')
    const targets = edition === 'research' ? ['research', 'research-economics'] : [edition]
    const artifacts = []
    const suffix = env('CANDIDATE_SUFFIX')
    if (!/^\d+-\d+$/.test(suffix)) throw new Error('Invalid candidate run/attempt')
    for (const target of targets) {
      const candidate = `${image}:candidate-${target}-${suffix}`
      const artifact = await registry.inspect(candidate)
      if (artifact.labels[label.edition] !== target) throw new ContractError('Candidate edition mismatch')
      assertPublication(artifact, policy)
      artifacts.push(artifact)
    }
    // All editions share the promotion job's concurrency lock. Fetch inside
    // that lock: a queued build may have become stale while it was waiting.
    const tree = sourceTree(edition)
    const source = git('rev-parse', 'HEAD')
    if (policy.track === 'release') {
      git('fetch', '--no-tags', 'origin', 'refs/tags/' + policy.release_tag)
      if (git('rev-parse', 'FETCH_HEAD^{commit}') !== source)
        throw new ContractError('Git release tag moved away from this build')
    } else {
      git('fetch', '--no-tags', 'origin', 'main')
    }
    let currentStandard = null
    const published = await existing(registry, image + ':' + policy.standard_tag)
    if (published) {
      try { assertPublication(published, policy); currentStandard = validateStandard(published) } catch (error) {
        if (!(error instanceof ContractError)) throw error
      }
    }
    const version = artifacts[0].labels[label.version]
    if (policy.track === 'release' && version !== git('show', 'HEAD:Dockerfile').match(/^ARG DSH_VERSION=(\S+)$/m)?.[1])
      throw new ContractError('Tagged releases must use the DSH version recorded in that Git tag')
    const base = artifacts[0].labels[label.base]
    if (edition !== 'standard' && currentStandard && version !== currentStandard.version)
      throw new ContractError('Derivative DSH version disagrees with its Standard image')
    for (const artifact of artifacts) {
      if (artifact.labels[label.tree] !== tree || artifact.labels[label.version] !== version
        || artifact.labels[label.base] !== base
        || artifact.labels['org.opencontainers.image.revision'] !== source)
        throw new ContractError('Candidate release labels disagree with this source')
    }
    if (edition === 'standard') validateStandard(artifacts[0], { source })
    if (policy.track === 'dev') {
      const currentTree = sourceTree(edition, 'origin/main')
      const desiredVersion = git('show', 'origin/main:Dockerfile').match(/^ARG DSH_VERSION=(\S+)$/m)?.[1]
      if (!desiredVersion) throw new Error('Cannot read current main DSH version')
      if (!mayPromote({ edition, tree, currentTree, version, desiredVersion, base, currentStandard })) {
        output({ promoted: false })
        console.log('Development candidate is stale; reconciliation will use current main and Standard.')
        return
      }
    } else if (edition !== 'standard' && (!currentStandard || base !== currentStandard.digest)) {
      throw new ContractError('Release derivative must use the Standard digest for the same Git tag')
    }
    let floating = true
    if (policy.track === 'release') {
      // Version tags stay immutable. Reruns reuse the original validated index.
      for (let i = 0; i < targets.length; i++) {
        const reference = publicationTags(image, targets[i], policy)[0]
        const previous = await registry.inspect(reference, { missingOK: true })
        if (!previous) continue
        for (const key of [label.track, label.releaseTag, label.tree, label.version, label.base,
          label.edition, label.standardSource, 'org.opencontainers.image.revision']) {
          if ((previous.labels[key] || '') !== (artifacts[i].labels[key] || ''))
            throw new ContractError('Published version is immutable; create a new Git tag: ' + reference)
        }
        artifacts[i] = previous
      }
      const latest = await existing(registry, image + ':latest')
      if (edition === 'standard') {
        const latestTag = latest?.labels[label.releaseTag]
        if (latestTag) floating = compareVersions(policy.release_version, publication('refs/tags/' + latestTag).release_version) >= 0
      } else {
        floating = !!latest && latest.digest === base
      }
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      const tags = publicationTags(image, target, policy, { suffix, source, floating })
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
