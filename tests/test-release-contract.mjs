import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Registry, ContractError, imageReference, label, validateStandard } from '../ci/registry.mjs'
import { needsStandard, needsDerivative, mayPromote, sourceTree, main } from '../ci/release.mjs'

const image = 'ghcr.io/example/dsh'
const version = '0.2.1-alpha.4'
const source = 'a'.repeat(40)
const tree = 'b'.repeat(64)
const digest = 'sha256:' + 'c'.repeat(64)
const labels = {
  [label.version]: version, [label.edition]: 'standard', [label.standardSource]: source,
  [label.tree]: tree, [label.channels]: 'alpha',
}
const standardArtifact = { image: image + '@' + digest, digest, labels }
const standard = validateStandard(standardArtifact)

// Actual OCI bytes and digests exercise the registry reader without a network
// service, Docker, or trusting fixture-provided digest strings.
function registryFixture({ architectures = ['amd64', 'arm64'], changeLabels = () => {}, corrupt = false } = {}) {
  const documents = new Map()
  function store(value) {
    const bytes = JSON.stringify(value)
    const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    documents.set(hash, bytes)
    return hash
  }
  const manifests = architectures.map(architecture => {
    const platformLabels = { ...labels }
    changeLabels(platformLabels, architecture)
    const configDigest = store({ os: 'linux', architecture, config: { Labels: platformLabels } })
    const manifestDigest = store({ schemaVersion: 2, config: { digest: configDigest } })
    return { digest: manifestDigest, platform: { os: 'linux', architecture } }
  })
  manifests.push({ digest: 'sha256:' + 'd'.repeat(64), platform: { os: 'unknown', architecture: 'unknown' } })
  const index = store({ schemaVersion: 2, manifests })
  let latest = index
  const calls = []
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.startsWith('https://ghcr.io/token?')) return Response.json({ token: 'fixture-token' })
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    const ref = url.split('/').at(-1)
    if (ref === 'private') return new Response('', { status: 403 })
    const key = ref === 'latest' ? latest : ref
    const body = documents.get(key)
    if (!body) return new Response('', { status: 404 })
    // Move the mutable tag immediately after its first read. Child reads must
    // continue using digests from the original index.
    if (ref === 'latest') latest = 'moved'
    return new Response(corrupt ? body + ' ' : body, { headers: { 'docker-content-digest': key } })
  }
  return { registry: new Registry(image, { fetcher, token: '' }), index, calls }
}

test('a mutable tag is read once and all platforms use immutable descriptors', async () => {
  const fixture = registryFixture()
  const artifact = await fixture.registry.inspect(image + ':latest')
  assert.equal(artifact.image, image + '@' + fixture.index)
  assert.equal(validateStandard(artifact).version, version)
  assert.equal(fixture.calls.filter(c => c.url.endsWith('/latest')).length, 1)
  assert.equal(fixture.calls.filter(c => c.url.includes('/manifests/sha256:')).length, 2)
})

test('untrusted repositories and malformed references are rejected before fetching', async () => {
  const { registry, calls } = registryFixture()
  for (const ref of ['ghcr.io/other/dsh:latest', image + ':latest@sha256:bad', image + '@sha256:bad', image + ':a\nb']) {
    await assert.rejects(registry.inspect(ref), ContractError)
  }
  assert.equal(calls.length, 0)
  assert.equal(imageReference(image, image + '@' + digest), digest)
})

test('both architectures and consistent release labels are mandatory', async () => {
  await assert.rejects(registryFixture({ architectures: ['amd64'] }).registry.inspect(image + ':latest'), /arm64/)
  const fixture = registryFixture({ changeLabels: (value, arch) => {
    if (arch === 'arm64') value[label.version] = '0.2.1-alpha.3'
  } })
  await assert.rejects(fixture.registry.inspect(image + ':latest'), /labels disagree/)
})

test('digest corruption fails closed', async () => {
  await assert.rejects(registryFixture({ corrupt: true }).registry.inspect(image + ':latest'), /digest mismatch/)
})

test('missing artifacts are distinct from authentication failures', async () => {
  const { registry } = registryFixture()
  assert.equal(await registry.inspect(image + ':missing', { missingOK: true }), null)
  await assert.rejects(registry.inspect(image + ':private', { missingOK: true }), /\(403\)/)
})

test('Standard contract binds version, edition and source provenance', () => {
  assert.throws(() => validateStandard(standardArtifact, { version: '0.2.1-alpha.3' }), /version mismatch/)
  assert.throws(() => validateStandard(standardArtifact, { source: 'd'.repeat(40) }), /revision mismatch/)
  assert.throws(() => validateStandard({ ...standardArtifact, labels: { ...labels, [label.edition]: 'reverse' } }), /contract/)
  assert.throws(() => validateStandard({ ...standardArtifact, labels: {} }), /contract/)
})

test('equal upstream versions still repair missing publication or changed Standard source', () => {
  assert.equal(needsStandard(null, version, tree), true)
  assert.equal(needsStandard({ ...standardArtifact, labels: {} }, version, tree), true)
  assert.equal(needsStandard(standardArtifact, version, tree), false)
  assert.equal(needsStandard(standardArtifact, version, 'e'.repeat(64)), true)
  assert.equal(needsStandard(standardArtifact, '0.2.1-alpha.5', tree), true)
})

test('reconciliation detects partial Research releases and wrong base digests', () => {
  const artifact = { ...standardArtifact, labels: { ...labels, [label.edition]: 'research', [label.base]: digest } }
  assert.equal(needsDerivative(artifact, 'research', standard, tree), false)
  assert.equal(needsDerivative(null, 'research-economics', standard, tree), true)
  assert.equal(needsDerivative(artifact, 'research-economics', standard, tree), true)
  assert.equal(needsDerivative(artifact, 'research', { ...standard, digest: 'sha256:' + 'e'.repeat(64) }, tree), true)
  assert.equal(needsDerivative(artifact, 'research', standard, 'e'.repeat(64)), true)
})

test('late candidates cannot overwrite newer source, base, or DSH versions', () => {
  const candidate = { edition: 'research', tree, currentTree: tree, version, desiredVersion: version, base: digest, currentStandard: standard }
  assert.equal(mayPromote(candidate), true)
  assert.equal(mayPromote({ ...candidate, currentTree: 'e'.repeat(64) }), false)
  assert.equal(mayPromote({ ...candidate, base: 'sha256:' + 'e'.repeat(64) }), false)
  assert.equal(mayPromote({ ...candidate, currentStandard: null }), false)
  const base = { ...candidate, edition: 'standard' }
  assert.equal(mayPromote(base), true)
  assert.equal(mayPromote({ ...base, desiredVersion: '0.2.1-alpha.5' }), false)
  assert.equal(mayPromote({ ...base, currentStandard: { ...standard, version: '0.2.1-alpha.5' } }), false)
})

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function inRepository(callback) {
  const original = process.cwd()
  const temp = mkdtempSync(join(tmpdir(), 'dsh-release-test-'))
  const saved = { ...process.env }
  try {
    process.chdir(temp)
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'CI')
    git('config', 'user.email', 'ci@example.test')
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=' + version + '\nRUN echo base\n')
    writeFileSync('docker-compose.yml', 'services:\n  dsh:\n    DSH_VERSION: "' + version + '"\n')
    mkdirSync('research')
    writeFileSync('research/VERSION', '1\n')
    git('add', '.')
    git('commit', '-qm', 'initial')
    // A local origin exercises the freshness fetch without any network.
    git('remote', 'add', 'origin', temp.replaceAll('\\', '/'))
    process.env.RELEASE_IMAGE = image
    process.env.CANDIDATE_SUFFIX = '123-1'
    process.env.GITHUB_OUTPUT = join(temp, 'outputs')
    await callback(temp)
  } finally {
    process.chdir(original)
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    rmSync(temp, { recursive: true, force: true })
  }
}

test('source identity survives a version-record commit and ignores unrelated edition changes', async () => {
  await inRepository(async () => {
    const base = sourceTree('standard')
    const research = sourceTree('research')
    writeFileSync('research/VERSION', '2\n')
    git('commit', '-qam', 'research fix')
    assert.equal(sourceTree('standard'), base)
    assert.notEqual(sourceTree('research'), research)
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=0.2.1-alpha.5\nRUN echo base\n')
    writeFileSync('docker-compose.yml', 'services:\n  dsh:\n    DSH_VERSION: "0.2.1-alpha.5"\n')
    git('commit', '-qam', 'record published version')
    assert.equal(sourceTree('standard'), base)
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=0.2.1-alpha.5\nRUN echo changed\n')
    git('commit', '-qam', 'change base')
    assert.notEqual(sourceTree('standard'), base)
  })
})

test('CLI reconciliation retries only the missing edition without rebuilding Standard', async () => {
  await inRepository(async temp => {
    const artifact = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard') } }
    const researchLabels = { ...labels, [label.tree]: sourceTree('research'), [label.base]: digest }
    const registry = { inspect: async ref => {
      if (ref.endsWith(':latest')) return artifact
      if (ref.endsWith(':research')) return { ...artifact, labels: { ...researchLabels, [label.edition]: 'research' } }
      if (ref.endsWith(':research-economics')) return { ...artifact, labels: { ...researchLabels, [label.edition]: 'research-economics' } }
      return null
    } }
    process.env.TARGET_VERSION = version
    await main('plan', '', { registry })
    await main('reconcile', '', { registry })
    const output = readFileSync(join(temp, 'outputs'), 'utf8')
    assert.match(output, /build=false/)
    assert.match(output, /research=false/)
    assert.match(output, /reverse=true/)
  })
})

test('standalone resolution waits for unpublished base changes and rejects version mismatch', async () => {
  await inRepository(async temp => {
    const registry = { inspect: async () => standardArtifact }
    await main('resolve', '', { registry })
    assert.match(readFileSync(join(temp, 'outputs'), 'utf8'), /ready=false/)
    process.env.REQUESTED_VERSION = '0.2.1-alpha.3'
    await assert.rejects(main('resolve', '', { registry }), /version mismatch/)
    process.env.TARGET_VERSION = version
    await assert.rejects(main('verify', '', { registry }), /does not match current source/)
  })
})

test('registry outages fail planning instead of requesting a rebuild', async () => {
  await inRepository(async () => {
    process.env.TARGET_VERSION = version
    await assert.rejects(main('plan', '', {
      registry: { inspect: async () => { throw new Error('Registry request failed (403)') } },
    }), /\(403\)/)
  })
})

test('promotion reruns use the build attempt suffix and never rebuild or re-resolve tags', async () => {
  await inRepository(async temp => {
    const candidate = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard') } }
    const inspected = []
    const registry = { inspect: async ref => {
      inspected.push(ref)
      return ref.includes(':candidate-standard-123-1') ? candidate : null
    } }
    process.env.GITHUB_RUN_ATTEMPT = '2'
    const dockerCalls = []
    await main('promote', 'standard', { registry, execute: (command, args, options) => {
      if (command === 'bash') {
        assert.equal(options.env.DSH_CHANNELS_RESOLVED, '1')
        return `${image}:${version}\n${image}:latest\n${image}:alpha\n`
      }
      assert.equal(command, 'docker')
      dockerCalls.push(args)
    } })
    assert.equal(inspected[0], image + ':candidate-standard-123-1')
    assert.equal(dockerCalls.length, 1)
    assert.equal(dockerCalls[0].at(-1), candidate.image)
    assert.match(readFileSync(join(temp, 'outputs'), 'utf8'), /promoted=true/)
  })
})

test('stale promotion performs no tag writes after fetching current main', async () => {
  await inRepository(async temp => {
    const candidate = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard') } }
    const old = git('rev-parse', 'HEAD')
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=' + version + '\nRUN echo newer\n')
    git('commit', '-qam', 'newer source')
    git('switch', '--detach', '-q', old)
    // The queued job still has its original checkout, but main advanced.
    let writes = 0
    await main('promote', 'standard', {
      registry: { inspect: async ref => ref.includes(':candidate-') ? candidate : null },
      execute: () => { writes++; },
    })
    assert.equal(writes, 0)
    assert.match(readFileSync(join(temp, 'outputs'), 'utf8'), /promoted=false/)
  })
})
