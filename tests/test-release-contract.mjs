import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Registry, ContractError, imageReference, label, validateStandard } from '../ci/registry.mjs'
import { needsStandard, needsDerivative, mayPromote, sourceTree, publication, publicationTags, main } from '../ci/release.mjs'

const image = 'ghcr.io/example/dsh'
const version = '0.2.1-alpha.4'
const source = 'a'.repeat(40)
const tree = 'b'.repeat(64)
const digest = 'sha256:' + 'c'.repeat(64)
const labels = {
  [label.version]: version, [label.edition]: 'standard', [label.standardSource]: source,
  [label.tree]: tree, [label.channels]: 'alpha',
  [label.track]: 'dev', [label.releaseTag]: '',
}
const standardArtifact = { image: image + '@' + digest, digest, labels }
const standard = validateStandard(standardArtifact)

test('only versioned Git tag refs select the release track', () => {
  for (const ref of ['refs/heads/main', 'refs/heads/v1.2.3', 'refs/pull/5/merge', ''])
    assert.equal(publication(ref).track, 'dev')
  assert.deepEqual(publication('refs/tags/v1.2.3-rc.1'), {
    track: 'release', release_tag: 'v1.2.3-rc.1', release_version: '1.2.3-rc.1', standard_tag: '1.2.3-rc.1',
  })
  for (const tag of ['v1', 'vlatest', 'v01.2.3', 'v1.2.3-01', 'v1.2.3+build', 'v1.2.3/other'])
    assert.throws(() => publication('refs/tags/' + tag))
})

test('development tags are isolated from every edition release alias', () => {
  for (const edition of ['standard', 'research', 'research-economics', 'reverse']) {
    const prefix = edition === 'standard' ? '' : edition + '-'
    assert.deepEqual(publicationTags(image, edition, publication('refs/heads/main'), { source, suffix: '42-3' }),
      [image + ':' + prefix + 'dev-' + source.slice(0, 12) + '-42-3', image + ':' + prefix + 'dev'])
    assert.deepEqual(publicationTags(image, edition, publication('refs/tags/v1.2.3')),
      [image + ':' + prefix + '1.2.3', image + ':' + (edition === 'standard' ? 'latest' : edition)])
  }
})

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
    process.env.GITHUB_REF = 'refs/heads/main'
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
      if (ref.endsWith(':dev')) return artifact
      if (ref.endsWith(':research-dev')) return { ...artifact, labels: { ...researchLabels, [label.edition]: 'research' } }
      if (ref.endsWith(':research-economics-dev')) return { ...artifact, labels: { ...researchLabels, [label.edition]: 'research-economics' } }
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
    const candidate = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard'),
      [label.standardSource]: git('rev-parse', 'HEAD'), 'org.opencontainers.image.revision': git('rev-parse', 'HEAD') } }
    const inspected = []
    const registry = { inspect: async ref => {
      inspected.push(ref)
      return ref.includes(':candidate-standard-123-1') ? candidate : null
    } }
    process.env.GITHUB_RUN_ATTEMPT = '2'
    const dockerCalls = []
    await main('promote', 'standard', { registry, execute: (command, args, options) => {
      assert.equal(command, 'docker')
      dockerCalls.push(args)
    } })
    assert.equal(inspected[0], image + ':candidate-standard-123-1')
    assert.equal(dockerCalls.length, 1)
    assert.equal(dockerCalls[0].at(-1), candidate.image)
    const tags = dockerCalls[0].filter((_, i, args) => args[i - 1] === '--tag')
    assert.deepEqual(tags, [image + ':dev-' + git('rev-parse', 'HEAD').slice(0, 12) + '-123-1', image + ':dev'])
    assert.match(readFileSync(join(temp, 'outputs'), 'utf8'), /promoted=true/)
  })
})

test('stale promotion performs no tag writes after fetching current main', async () => {
  await inRepository(async temp => {
    const candidate = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard'),
      [label.standardSource]: git('rev-parse', 'HEAD'), 'org.opencontainers.image.revision': git('rev-parse', 'HEAD') } }
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

function releaseCandidate(edition, tag, base) {
  const source = git('rev-parse', 'HEAD')
  return { ...standardArtifact, labels: { ...labels, [label.track]: 'release', [label.releaseTag]: tag,
    [label.edition]: edition, [label.tree]: sourceTree(edition === 'research-economics' ? 'research' : edition),
    [label.standardSource]: source, 'org.opencontainers.image.revision': source,
    ...(base ? { [label.base]: base } : {}),
  } }
}

test('tagged publication uses the tagged commit even after main advances', async () => {
  await inRepository(async () => {
    git('tag', '-a', 'v1.2.3', '-m', 'release')
    const candidate = releaseCandidate('standard', 'v1.2.3')
    const taggedSource = git('rev-parse', 'HEAD')
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=' + version + '\nRUN echo next development\n')
    git('commit', '-qam', 'main advances')
    git('switch', '--detach', '-q', taggedSource)
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    const calls = []
    await main('promote', 'standard', {
      registry: { inspect: async ref => ref.includes(':candidate-') ? candidate : null },
      execute: (command, args) => { assert.equal(command, 'docker'); calls.push(args) },
    })
    assert.deepEqual(calls[0].filter((_, i, args) => args[i - 1] === '--tag'), [image + ':1.2.3', image + ':latest'])
    assert.equal(calls[0].at(-1), candidate.image)
  })
})

test('older Git releases keep their version tag without rolling latest backwards', async () => {
  await inRepository(async () => {
    git('tag', 'v1.2.3')
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    const candidate = releaseCandidate('standard', 'v1.2.3')
    const latest = { ...candidate, labels: { ...candidate.labels, [label.releaseTag]: 'v2.0.0' } }
    const calls = []
    await main('promote', 'standard', {
      registry: { inspect: async ref => ref.includes(':candidate-') ? candidate : ref.endsWith(':latest') ? latest : null },
      execute: (_command, args) => calls.push(args),
    })
    assert.deepEqual(calls[0].filter((_, i, args) => args[i - 1] === '--tag'), [image + ':1.2.3'])
  })
})

test('release reruns reuse the original index and reject changes to published versions', async () => {
  await inRepository(async temp => {
    git('tag', 'v1.2.3')
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    const candidate = releaseCandidate('standard', 'v1.2.3')
    const original = { ...candidate, image: image + '@sha256:' + 'd'.repeat(64), digest: 'sha256:' + 'd'.repeat(64) }
    // npm channels can move between retries; the original index and metadata win.
    candidate.labels = { ...candidate.labels, [label.channels]: '' }
    const calls = []
    const registry = { inspect: async ref => ref.includes(':candidate-') ? candidate
      : ref.endsWith(':1.2.3') ? original : null }
    await main('promote', 'standard', { registry, execute: (_command, args) => calls.push(args) })
    assert.equal(calls[0].at(-1), original.image)
    assert.match(readFileSync(join(temp, 'outputs'), 'utf8'), new RegExp('base_image=' + original.image))
    original.labels = { ...original.labels, 'org.opencontainers.image.revision': 'e'.repeat(40) }
    await assert.rejects(main('promote', 'standard', { registry, execute: () => assert.fail('must not retag') }), /immutable/)
  })
})

test('development resolution never falls back to a release and release resolution rejects a dev base', async () => {
  await inRepository(async () => {
    const refs = []
    const artifact = { ...standardArtifact, labels: { ...labels, [label.tree]: sourceTree('standard') } }
    const registry = { inspect: async ref => { refs.push(ref); return artifact } }
    await main('resolve', '', { registry })
    assert.deepEqual(refs, [image + ':dev'])
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    process.env.REQUESTED_BASE = artifact.image
    await assert.rejects(main('resolve', '', { registry }), /track or Git release tag mismatch/)
  })
})

test('moved release refs and DSH version overrides cannot publish', async () => {
  await inRepository(async () => {
    git('tag', 'v1.2.3')
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    const candidate = releaseCandidate('standard', 'v1.2.3')
    const registry = { inspect: async ref => ref.includes(':candidate-') ? candidate : null }
    const execute = () => assert.fail('invalid release must not move any image tags')
    candidate.labels[label.version] = '0.2.1-alpha.5'
    await assert.rejects(main('promote', 'standard', { registry, execute }), /recorded in that Git tag/)
    candidate.labels[label.version] = version
    const source = git('rev-parse', 'HEAD')
    writeFileSync('Dockerfile', 'ARG DSH_VERSION=' + version + '\nRUN echo moved tag\n')
    git('commit', '-qam', 'new source')
    git('tag', '-f', 'v1.2.3')
    git('switch', '--detach', '-q', source)
    await assert.rejects(main('promote', 'standard', { registry, execute }), /tag moved/)
  })
})

test('manual branch builds cannot publish release aliases or promote non-main dev images', async () => {
  await inRepository(async () => {
    const candidate = releaseCandidate('standard', 'v1.2.3')
    const registry = { inspect: async () => candidate }
    const execute = () => assert.fail('invalid candidate must not publish')
    await assert.rejects(main('promote', 'standard', { registry, execute }), /track or Git release tag mismatch/)
    process.env.GITHUB_REF = 'refs/heads/feature'
    await assert.rejects(main('promote', 'standard', { registry, execute }), /requires the main branch/)
  })
})

test('derivative releases require the exact Standard release and old releases cannot move its floating aliases', async () => {
  await inRepository(async () => {
    git('tag', 'v1.2.3')
    process.env.GITHUB_REF = 'refs/tags/v1.2.3'
    const standard = releaseCandidate('standard', 'v1.2.3')
    const candidate = releaseCandidate('reverse', 'v1.2.3', standard.digest)
    const calls = []
    const registry = { inspect: async ref => ref.includes(':candidate-') ? candidate
      : ref.endsWith(':1.2.3') ? standard : ref.endsWith(':latest') ? { ...standard, digest: 'sha256:' + 'f'.repeat(64) } : null }
    await main('promote', 'reverse', { registry, execute: (_command, args) => calls.push(args) })
    assert.deepEqual(calls[0].filter((_, i, args) => args[i - 1] === '--tag'), [image + ':reverse-1.2.3'])
    candidate.labels[label.version] = '0.2.1-alpha.3'
    await assert.rejects(main('promote', 'reverse', { registry, execute: () => assert.fail('must not mislabel version') }), /version recorded|version disagrees/)
    candidate.labels[label.version] = version
    standard.digest = 'sha256:' + 'e'.repeat(64)
    await assert.rejects(main('promote', 'reverse', { registry, execute: () => assert.fail('must not publish wrong base') }), /same Git tag/)
  })
})
