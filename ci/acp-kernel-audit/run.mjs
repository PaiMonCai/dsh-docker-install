import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { baselineRoot, repo, readFixture, loadAdapter, probeLegacySession, probeTieredAdapter } from './compatibility.mjs'
import { sha256, readJson, fileInventory, describeApi, compareApis } from './api-diff.mjs'

const home = import.meta.dirname
const snapshot = await readJson(resolve(home, 'snapshot.json'))
const auditCheckout = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()),
  githubRunId: process.env.GITHUB_RUN_ID ?? null,
}
const output = resolve(home, 'node_modules/.cache/m0-output')
await mkdir(output, { recursive: true })
const work = await mkdtemp(resolve(home, 'node_modules/.cache/m0-work-'))
const source = resolve(work, 'source')
const candidate = resolve(source, 'kernel')
const npmPath = process.platform === 'win32'
  ? resolve(dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js')
  : await realpath(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim())

async function command(name, binary, args, cwd, env = {}) {
  console.log('M0:', name)
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: 300000, env: { ...process.env, ...env } })
  if (result.error) throw result.error
  const log = (result.stdout + result.stderr).replaceAll(work, '<audit-work>').replaceAll(repo, '<repo>')
  await writeFile(resolve(output, name + '.log'), log)
  return { exitCode: result.status, log }
}
const npm = (name, args, cwd) => command(name, process.execPath, [npmPath, ...args], cwd)
const gh = (args, buffer = false) => execFileSync('gh', ['api', ...args],
  { encoding: buffer ? undefined : 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 60000 })

console.log('M0: verifying immutable registry package and upstream commit')
const response = await fetch('https://registry.npmjs.org/acp-kernel')
assert.equal(response.ok, true, 'npm registry is reachable')
const registry = await response.json()
const published = registry.versions[snapshot.baseline.version]
assert.equal(published.dist.integrity, snapshot.baseline.integrity)
assert.equal(published.dist.tarball, snapshot.baseline.tarball)
assert.equal(published.gitHead, snapshot.baseline.gitHead)
const tarball = await fetch(snapshot.baseline.tarball)
assert.equal(tarball.ok, true)
const bytes = Buffer.from(await tarball.arrayBuffer())
assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), snapshot.baseline.integrity)
await writeFile(resolve(output, 'baseline-package.tgz'), bytes)
const baselineExtract = resolve(work, 'baseline-package')
await mkdir(baselineExtract)
assert.equal((await command('baseline-extract', 'tar', ['-xzf', resolve(output, 'baseline-package.tgz'),
  '-C', baselineExtract, '--strip-components=1'], repo)).exitCode, 0)
assert.deepEqual(await fileInventory(resolve(baselineRoot, 'dist')),
  await fileInventory(resolve(baselineExtract, 'dist')), 'installed baseline matches verified npm tarball')
for (const name of ['package.json', 'LICENSE']) {
  assert.equal(sha256(await readFile(resolve(baselineRoot, name))),
    sha256(await readFile(resolve(baselineExtract, name))), 'installed baseline ' + name)
}
const npmView = await npm('registry-npm-view', ['view', 'acp-kernel@' + snapshot.baseline.version,
  'version', 'dist', 'engines', 'exports', 'dependencies', 'license', 'gitHead',
  '--json', '--registry=https://registry.npmjs.org'], repo)
assert.equal(npmView.exitCode, 0)
assert.equal(JSON.parse(npmView.log).version, snapshot.baseline.version)
const observation = { observedAt: new Date().toISOString(), registry: 'https://registry.npmjs.org/acp-kernel',
  latestStableTag: registry['dist-tags'].latest,
  candidateVersionPublished: Boolean(registry.versions[snapshot.candidate.sourceVersion]),
  baseline: { version: published.version, publishedAt: registry.time[published.version],
    gitHead: published.gitHead, dist: published.dist, exports: published.exports,
    engines: published.engines, dependencies: published.dependencies ?? {}, licenseDeclaration: published.license } }
await writeFile(resolve(output, 'registry.json'), JSON.stringify(observation, null, 2) + '\n')

const tree = JSON.parse(gh([`repos/${snapshot.candidate.repository}/git/trees/${snapshot.candidate.commit}?recursive=1`]))
assert.equal(tree.truncated, false)
assert.equal(tree.tree.find(entry => entry.path === 'kernel').sha, snapshot.candidate.kernelTree)
const archive = resolve(work, 'source.tgz')
await writeFile(archive, gh([`repos/${snapshot.candidate.repository}/tarball/${snapshot.candidate.commit}`], true))
await mkdir(source)
const extracted = await command('extract', 'tar', ['-xzf', archive, '-C', source, '--strip-components=1',
  snapshot.candidate.archiveRoot + '/kernel', snapshot.candidate.archiveRoot + '/LICENSE'], repo)
assert.equal(extracted.exitCode, 0, 'extract pinned source')
let checkedFiles = 0
for (const entry of tree.tree.filter(e => e.type === 'blob' && (e.path.startsWith('kernel/') || e.path === 'LICENSE'))) {
  assert.ok(['100644', '100755'].includes(entry.mode), 'audit only regular source files')
  const data = await readFile(resolve(source, entry.path))
  const gitHash = createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex')
  assert.equal(gitHash, entry.sha, 'immutable Git blob: ' + entry.path)
  checkedFiles++
}
for (const [file, expected] of Object.entries(snapshot.candidate.sha256)) {
  assert.equal(sha256(await readFile(resolve(source, file))), expected, 'snapshot checksum: ' + file)
}
assert.equal((await readJson(resolve(candidate, 'package.json'))).version, snapshot.candidate.sourceVersion)
assert.equal((await readJson(resolve(repo, 'docker/plugins/dsh-context-manager/package.json'))).dependencies['acp-kernel'],
  snapshot.baseline.version, 'M0 must not upgrade the production dependency')
assert.equal((await npm('source-install', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], candidate)).exitCode, 0)
const build = await npm('source-build', ['run', 'build'], candidate)
// Failed type generation may still emit JS/declarations. These are diagnostic
// inputs only; never convert their presence into an upgrade approval.
const ts = await import(pathToFileURL(resolve(candidate, 'node_modules/typescript/lib/typescript.js')).href)
const before = await describeApi(baselineRoot, ts.default)
const after = await describeApi(candidate, ts.default)
const diff = compareApis(before, after)
const required = ['createCore', 'createInitialState', 'defaultConfig', 'collectBlockContent', 'summaryMessageId']
for (const name of required) {
  assert.ok(before.runtimeExports.includes(name), 'baseline adapter export: ' + name)
  assert.ok(after.runtimeExports.includes(name), 'candidate adapter export: ' + name)
}
await writeFile(resolve(output, 'api-baseline.json'), JSON.stringify(before, null, 2) + '\n')
await writeFile(resolve(output, 'api-candidate.json'), JSON.stringify(after, null, 2) + '\n')
await writeFile(resolve(output, 'api-diff.json'), JSON.stringify(diff, null, 2) + '\n')
const fixture = await readFixture()
assert.equal(sha256(await readFile(resolve(repo, 'tests/fixtures/context-manager/acp-0.0.101-session.json'))),
  snapshot.legacyFixtureSha256, 'frozen legacy fixture checksum')
const legacy = {}
const tiers = {}
for (const [name, root] of [['baseline', baselineRoot], ['candidate', candidate]]) {
  const adapter = await loadAdapter(root, resolve(work, 'adapter-' + name))
  legacy[name] = await probeLegacySession(adapter, fixture)
  tiers[name] = await probeTieredAdapter(adapter)
}
assert.deepEqual(tiers.candidate, tiers.baseline, 'T1/T2/T3 semantic bridge parity')
const regression = await command('legacy-regression', process.execPath,
  ['--test', 'tests/test-context-manager-kernel-audit.mjs'], repo, { ACP_AUDIT_CANDIDATE: candidate })
assert.equal(regression.exitCode, 0, 'legacy regression suite; see artifact log')
const upstreamTests = (await readdir(resolve(candidate, 'tests'))).filter(name => name.endsWith('.test.ts')).sort()
const upstream = await command('upstream-tests', process.execPath,
  ['--import', 'tsx', '--test', '--test-concurrency=4', '--test-reporter=tap',
    ...upstreamTests.map(name => 'tests/' + name)], candidate)
const diagnosticCodes = [...new Set([...build.log.matchAll(/error (TS\d+):/g)].map(m => m[1]))].sort()
const reasons = []
if (!observation.candidateVersionPublished) reasons.push('candidate-source-version-not-published-to-npm')
if (build.exitCode !== 0) reasons.push('upstream-clean-build-failed')
if (upstream.exitCode !== 0) reasons.push('upstream-tests-failed')
if (diff.runtimeRemoved.length || diff.declarationsChanged.length)
  reasons.push('breaking-api-and-state-diff-needs-reviewed-compatibility-design')
reasons.push('native-image-regression-pending')
const sourceLock = await readJson(resolve(candidate, 'package-lock.json'))
const dependencyInventory = Object.entries(sourceLock.packages).map(([path, pkg]) => ({
  path, version: pkg.version, integrity: pkg.integrity ?? null, resolved: pkg.resolved ?? null,
  license: pkg.license ?? null, dev: pkg.dev === true, optional: pkg.optional === true,
  os: pkg.os ?? null, cpu: pkg.cpu ?? null,
}))
await writeFile(resolve(output, 'source-build-dependencies.json'), JSON.stringify(dependencyInventory, null, 2) + '\n')
const diagnostic = resolve(output, 'diagnostic-only')
await mkdir(diagnostic, { recursive: true })
await cp(resolve(candidate, 'dist'), resolve(diagnostic, 'dist'), { recursive: true })
await cp(resolve(candidate, 'package.json'), resolve(diagnostic, 'package.json'))
await cp(resolve(candidate, 'LICENSE'), resolve(diagnostic, 'LICENSE'))
await writeFile(resolve(diagnostic, 'AUDIT-ONLY.txt'),
  'Diagnostic output from a failed clean build. Not a release package or an approved runtime dependency.\n'
  + snapshot.candidate.repository + '@' + snapshot.candidate.commit + '\n')
for (const [name, path] of [['baseline-LICENSE.txt', resolve(baselineRoot, 'LICENSE')],
  ['candidate-kernel-LICENSE.txt', resolve(candidate, 'LICENSE')], ['candidate-project-LICENSE.txt', resolve(source, 'LICENSE')]]) {
  await cp(path, resolve(output, name))
}
const evidence = {
  schemaVersion: 1, snapshot, auditCheckout,
  sourceBlobVerification: { kernelTree: snapshot.candidate.kernelTree, checkedFiles },
  registryObservation: { observedOn: snapshot.observedOn, latestStableTag: observation.latestStableTag,
    candidateVersionPublished: observation.candidateVersionPublished, baselinePublishedAt: registry.time[published.version] },
  build: { exitCode: build.exitCode, diagnosticCodes,
    typescriptErrors: [...build.log.matchAll(/error TS\d+:/g)].length,
    distribution: 'diagnostic-only; not approved for deployment', node: process.version, platform: process.platform },
  runtimeApi: { baselineCount: before.runtimeExports.length, candidateCount: after.runtimeExports.length,
    added: diff.runtimeAdded, removed: diff.runtimeRemoved, coreMethodsChanged: diff.coreMethodsChanged,
    exportPathsChanged: diff.exportPathsChanged },
  declarations: { added: diff.declarationsAdded, removed: diff.declarationsRemoved,
    changed: diff.declarationsChanged.map(({ name, before, after }) => ({ name, before: before.sha256, after: after.sha256 })) },
  defaultsChanged: diff.defaultsChanged, initialStateChanged: diff.initialStateChanged,
  legacy, tiers, legacyRegressionExitCode: regression.exitCode, upstreamTestsExitCode: upstream.exitCode,
  upstreamTestCounts: Object.fromEntries([...upstream.log.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)]
    .map(match => [match[1], Number(match[2])])),
  fixtureSha256: sha256(await readFile(resolve(repo, 'tests/fixtures/context-manager/acp-0.0.101-session.json'))),
  licenses: { baseline: sha256(await readFile(resolve(baselineRoot, 'LICENSE'))),
    candidateKernel: snapshot.candidate.sha256['kernel/LICENSE'], candidateProject: snapshot.candidate.sha256.LICENSE,
    conclusion: 'MIT declaration plus product attribution additional term; preserve full texts and attribution' },
  artifacts: await fileInventory(resolve(diagnostic, 'dist')),
  decision: { auditCompleted: true, upgradeAllowed: false, reasons },
}
await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
if (process.argv.includes('--record')) {
  await writeFile(resolve(home, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  for (const name of ['baseline-LICENSE.txt', 'candidate-kernel-LICENSE.txt', 'candidate-project-LICENSE.txt']) {
    await cp(resolve(output, name), resolve(home, name))
  }
}
console.log(JSON.stringify({ status: 'AUDIT_COMPLETE_UPGRADE_BLOCKED', output,
  buildExitCode: build.exitCode, upstreamTestsExitCode: upstream.exitCode,
  runtimeAdded: diff.runtimeAdded.length, runtimeRemoved: diff.runtimeRemoved.length, reasons }, null, 2))
if (process.argv.includes('--require-upgrade-ready')) process.exitCode = 1
