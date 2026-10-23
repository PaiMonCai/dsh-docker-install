import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compareApis, describeApi, fileInventory, sha256 } from './api-diff.mjs'
import { loadAdapter, probeLegacySession, probeTieredAdapter, readFixture } from './compatibility.mjs'

// Rebuild the unpublished, pinned snapshot with a type-resolution-only patch.
// The M0 runner still reports the unmodified upstream build independently.
const home = import.meta.dirname
const snapshot = JSON.parse(await readFile(resolve(home, 'native-snapshot.json'), 'utf8'))
const repo = resolve(home, '../..')
const vendor = resolve(repo, 'docker/plugins/dsh-context-manager/vendor')
const output = resolve(home, 'node_modules/.cache/native-output')
await mkdir(output, { recursive: true })
await mkdir(resolve(home, 'node_modules/.cache'), { recursive: true })
const work = await mkdtemp(resolve(home, 'node_modules/.cache/native-build-'))
const source = resolve(work, 'source')
const kernel = resolve(source, 'kernel')
const npm = process.platform === 'win32'
  ? resolve(dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js')
  : await realpath(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim())
const gh = args => execFileSync('gh', ['api', ...args], { maxBuffer: 100 * 1024 * 1024, timeout: 60000 })
const command = (args, cwd) => execFileSync(process.execPath, [npm, ...args],
  { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000 })
const tree = JSON.parse(gh([`repos/${snapshot.candidate.repository}/git/trees/${snapshot.candidate.commit}?recursive=1`]))
assert.equal(tree.truncated, false)
assert.equal(tree.tree.find(e => e.path === 'kernel').sha, snapshot.candidate.kernelTree)
await mkdir(source)
if (process.env.ACP_SOURCE_DIRECTORY) {
  await cp(process.env.ACP_SOURCE_DIRECTORY, kernel, { recursive: true,
    filter: path => !/^(node_modules|dist)(?:[\\/]|$)/.test(relative(process.env.ACP_SOURCE_DIRECTORY, path)) })
  await cp(resolve(process.env.ACP_SOURCE_DIRECTORY, '../LICENSE'), resolve(source, 'LICENSE'))
} else {
  const archive = resolve(work, 'source.tgz')
  await writeFile(archive, gh([`repos/${snapshot.candidate.repository}/tarball/${snapshot.candidate.commit}`]))
  execFileSync('tar', ['-xzf', archive, '-C', source, '--strip-components=1',
    snapshot.candidate.archiveRoot + '/kernel', snapshot.candidate.archiveRoot + '/LICENSE'])
}
let verified = 0
for (const entry of tree.tree.filter(e => e.type === 'blob' && (e.path.startsWith('kernel/') || e.path === 'LICENSE'))) {
  assert.ok(['100644', '100755'].includes(entry.mode))
  const bytes = await readFile(resolve(source, entry.path))
  assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), entry.sha, entry.path)
  verified++
}
for (const [path, hash] of Object.entries(snapshot.candidate.sha256)) {
  assert.equal(sha256(await readFile(resolve(source, path))), hash)
}
assert.equal(JSON.parse(await readFile(resolve(kernel, 'package.json'), 'utf8')).version, snapshot.candidate.sourceVersion)
for (const fixture of snapshot.fixtures) {
  assert.equal(sha256(await readFile(resolve(repo, fixture.path))), fixture.sha256, fixture.path)
}
const config = JSON.parse(await readFile(resolve(kernel, 'tsconfig.json'), 'utf8'))
config.compilerOptions.paths = { 'acp-kernel': ['./src/index.ts'] }
await writeFile(resolve(kernel, 'tsconfig.json'), JSON.stringify(config, null, 2) + '\n')
// tsup expands array entries through an asynchronous glob, whose order can
// change emitted imports. Named entries preserve the original declared order.
const entries = { index: 'src/index.ts', 'wire/index': 'src/wire/index.ts',
  'panel/index': 'src/panel/index.ts', 'persist/index': 'src/persist/index.ts' }
const tsup = await readFile(resolve(kernel, 'tsup.config.ts'), 'utf8')
assert.match(tsup, /entry: \[[\s\S]*?\],/)
await writeFile(resolve(kernel, 'tsup.config.ts'), tsup.replace(/entry: \[[\s\S]*?\],/,
  'entry: ' + JSON.stringify(entries, null, 2) + ','))
await writeFile(resolve(work, 'install.log'), command(['ci', '--ignore-scripts', '--no-audit', '--no-fund'], kernel))
await writeFile(resolve(work, 'build.log'), command(['run', 'build'], kernel))
const adapter = await loadAdapter(kernel, resolve(work, 'adapter'))
const legacy = await probeLegacySession(adapter, await readFixture())
const fixtures = []
for (const fixture of snapshot.fixtures) {
  fixtures.push({ ...fixture, replay: await probeLegacySession(adapter,
    JSON.parse(await readFile(resolve(repo, fixture.path), 'utf8'))) })
}
const tiers = await probeTieredAdapter(adapter)
const distribution = await fileInventory(resolve(kernel, 'dist'))
// Check reproducibility of every output byte before creating a distributable.
await writeFile(resolve(work, 'rebuild.log'), command(['run', 'build'], kernel))
assert.deepEqual(await fileInventory(resolve(kernel, 'dist')), distribution, 'two clean builds must be byte-identical')
const baseline = resolve(work, 'baseline')
await mkdir(baseline)
const baselineBytes = await readFile(resolve(vendor, snapshot.baseline.artifact))
assert.equal(sha256(baselineBytes), snapshot.baseline.sha256)
assert.equal('sha512-' + createHash('sha512').update(baselineBytes).digest('base64'), snapshot.baseline.integrity)
execFileSync('tar', ['-xzf', resolve(vendor, snapshot.baseline.artifact), '-C', baseline, '--strip-components=1'])
assert.equal(JSON.parse(await readFile(resolve(baseline, 'package.json'), 'utf8')).version, snapshot.baseline.version)
const ts = await import(pathToFileURL(resolve(kernel, 'node_modules/typescript/lib/typescript.js')).href)
const before = await describeApi(baseline, ts.default)
const after = await describeApi(kernel, ts.default)
const api = compareApis(before, after)
for (const [name, value] of [['api-baseline', before], ['api-candidate', after], ['api-diff', api]]) {
  await writeFile(resolve(output, name + '.json'), JSON.stringify(value, null, 2) + '\n')
}
const upstreamFiles = (await readdir(resolve(kernel, 'tests'))).filter(name => name.endsWith('.test.ts')).sort()
assert.ok(upstreamFiles.length > 0)
const tested = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=4', '--test-reporter=tap',
  ...upstreamFiles.map(name => 'tests/' + name)], { cwd: kernel, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000 })
await writeFile(resolve(output, 'upstream-tests.log'), (tested.stdout ?? '') + (tested.stderr ?? ''))
if (tested.error) throw tested.error
assert.equal(tested.status, 0, 'upstream Kernel tests must pass; inspect native-output/upstream-tests.log')
const upstreamTests = Object.fromEntries([...tested.stdout.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)]
  .map(match => [match[1], Number(match[2])]))
const pkg = JSON.parse(await readFile(resolve(kernel, 'package.json'), 'utf8'))
pkg.version = snapshot.candidate.sourceVersion + '-dsh.' + snapshot.candidate.commit.slice(0, 8) + '.1'
await writeFile(resolve(kernel, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
await mkdir(vendor, { recursive: true })
const packed = JSON.parse(command(['pack', '--ignore-scripts', '--json', '--pack-destination', work], kernel))[0]
const artifact = 'acp-kernel-' + pkg.version + '.tgz'
const bytes = await readFile(resolve(work, packed.filename))
const provenance = {
  schemaVersion: 1, artifact, version: pkg.version, upstream: snapshot.candidate,
  patch: { compilerOptions: { paths: config.compilerOptions.paths }, tsupNamedEntries: entries, runtimeAlgorithmChanges: false },
  verifiedGitBlobs: verified, sha256: sha256(bytes), integrity: packed.integrity,
  node: process.version, dependencyLockSha256: sha256(await readFile(resolve(kernel, 'package-lock.json'))),
  distribution, legacy, tiers, reproducibleCleanBuild: true,
  upgrade: { baseline: snapshot.baseline, fixtures, upstreamTests,
    api: { ...api, declarationsChanged: api.declarationsChanged.map(({ name, before, after }) =>
      ({ name, before: before.sha256, after: after.sha256 })) } },
}
if (process.argv.includes('--check')) {
  assert.deepEqual(await readFile(resolve(vendor, artifact)), bytes, 'committed tarball must match an independent source rebuild')
  const committed = JSON.parse(await readFile(resolve(vendor, 'provenance.json'), 'utf8'))
  assert.deepEqual(committed.distribution, distribution)
  assert.equal(committed.sha256, provenance.sha256)
  assert.deepEqual(committed.upgrade, provenance.upgrade)
} else {
  await writeFile(resolve(vendor, artifact), bytes)
  await cp(resolve(source, 'LICENSE'), resolve(vendor, 'billion-context-LICENSE.txt'))
  await cp(resolve(kernel, 'LICENSE'), resolve(vendor, 'acp-kernel-LICENSE.txt'))
  await writeFile(resolve(vendor, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
}
for (const name of ['install.log', 'build.log', 'rebuild.log']) await cp(resolve(work, name), resolve(output, name))
await writeFile(resolve(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify({ artifact, work, integrity: packed.integrity, legacy, tiers }))
