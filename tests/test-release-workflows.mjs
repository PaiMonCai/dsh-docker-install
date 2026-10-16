#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { paths } from '../ci/release.mjs'

const read = name => readFileSync('.github/workflows/' + name + '.yml', 'utf8')
const base = read('build')
const update = read('check-update')
const promotion = read('promote-release')
const dispatch = read('dispatch-edition')
function job(text, name) {
  const jobs = text.slice(text.indexOf('\njobs:'))
  const start = jobs.indexOf('\n  ' + name + ':\n')
  assert.notEqual(start, -1, 'Missing job: ' + name)
  return jobs.slice(start + 1).split(/\n(?=  [\w-]+:\n)/)[0]
}
function eventPaths(text, event) {
  const section = text.split('\n  ' + event + ':\n')[1]?.split(/\n  \w/)[0]
  return [...section.matchAll(/^      - (.+)$/gm)].map(match => match[1])
}
function step(text, name) {
  const start = text.indexOf('      - name: ' + name + '\n')
  assert.notEqual(start, -1, 'Missing step: ' + name)
  return text.slice(start).split(/\n(?=      - )/)[0]
}
function triggerPaths() {
  const directories = new Set(['docker', 'ci', 'docs', 'tests'])
  return paths.standard.map(path => directories.has(path) ? path + '/**' : path)
}
for (const event of ['push', 'pull_request']) {
  assert.deepEqual(eventPaths(base, event).sort(), triggerPaths().sort(), 'Standard paths must match the shared gate definition')
}
assert.match(base, /node --test tests\/test-release-contract\.mjs/)
assert.doesNotMatch(step(base, 'Build amd64 audit image'), /cache-to:/, 'amd64 audit must preserve the multi-platform cache')
assert.doesNotMatch(step(read('build-reverse'), 'Build Reverse release audit image before any GHCR push'), /cache-to:/)
assert.match(base, /tags: .*:candidate-standard-/)
assert.doesNotMatch(base, /tags: \$\{\{ steps\.tags/, 'Builds must not move release tags')
assert.match(job(base, 'promote'), /needs: build/)
assert.match(job(base, 'promote'), /candidate_suffix: \$\{\{ needs\.build\.outputs\.candidate_suffix/)
for (const edition of ['research', 'reverse']) {
  const downstream = read('build-' + edition)
  assert.doesNotMatch(downstream.split('\njobs:')[0], /\nconcurrency:/, 'Skipped mixed pushes must not cancel active releases')
  assert.doesNotMatch(downstream, /ref: .*inputs\.source_sha/, 'Base provenance cannot select edition source')
  for (const checkout of downstream.matchAll(/uses: actions\/checkout@v4([\s\S]*?)(?=\n      -|\n  \w|$)/g)) {
    assert.match(checkout[1], /ref: \$\{\{ github\.sha \}\}/)
  }
  const prepare = job(downstream, 'prepare')
  assert.match(prepare, new RegExp('bash ci/' + edition + '-push-gate.sh'))
  assert.equal([...downstream.matchAll(/node ci\/release\.mjs resolve/g)].length, 1, 'Resolve the base once before builds')
  assert.match(prepare, /Detect changed Standard base on PR/)
  assert.match(prepare, /if \[\[ "\$CANDIDATE" == true \]\]/)
  assert.match(job(downstream, 'build'), /BASE_IMAGE=\$\{\{ (needs\.prepare\.outputs\.base_image|steps\.effective_base\.outputs\.image)/)
  assert.match(job(downstream, 'build'), /io\.caicailo\.dsh\.base\.digest=\$\{\{ needs\.prepare\.outputs\.digest/)
  assert.match(job(downstream, 'build'), /candidate_suffix: \$\{\{ needs\.prepare\.outputs\.candidate_suffix/)
  assert.match(job(downstream, 'promote'), /needs: build/)
  const queue = job(base, 'dispatch-' + edition)
  assert.match(queue, /needs: promote/)
  assert.match(queue, /uses: \.\/\.github\/workflows\/dispatch-edition\.yml/)
  assert.doesNotMatch(queue, /needs:.*dispatch-/, 'Dispatch failures must be isolated')
  assert.match(queue, /inputs\.skip_dispatch != true/)
  const condition = queue.match(/^    if: (.+)$/m)[1]
  // Actions coerces absent non-dispatch inputs to an empty string. For these
  // scalar comparisons JS has the same coercion, including '' == false.
  for (const [value, expected] of [['', true], [false, true], [true, false]]) {
    assert.equal(runInNewContext(condition, {
      needs: { promote: { outputs: { promoted: 'true' } } },
      inputs: { skip_dispatch: value },
    }), expected, 'Dispatch condition must support push, default call and updater opt-out')
  }
}
assert.match(read('build-research'), /Build candidate Standard and Research together/)
assert.match(read('build-research'), /- target: research-economics/)
assert.match(promotion, /concurrency:[\s\S]*cancel-in-progress: false/)
assert.match(promotion, /queue: max/, 'Pending promotions must not replace each other')
assert.match(update, /queue: max/)
assert.match(promotion, /node ci\/release\.mjs promote/)
assert.match(promotion, /CANDIDATE_SUFFIX: \$\{\{ inputs\.candidate_suffix/)
assert.match(dispatch, /--ref main/)
assert.match(dispatch, /--field "source_sha=\$RELEASE_SOURCE"/)
assert.match(dispatch, /continue-on-error: true/)
assert.match(dispatch, /for attempt in 1 2 3/)
assert.match(job(update, 'check'), /node ci\/release\.mjs plan/)
assert.match(job(update, 'build'), /if: needs\.check\.outputs\.build == 'true'/)
assert.match(job(update, 'build'), /skip_dispatch: true/, 'Updater reconciliation owns dispatch to avoid duplicate builds')
assert.match(job(update, 'commit'), /needs: \[check, build\]/)
assert.match(job(update, 'commit'), /needs\.build\.outputs\.promoted == 'true'/)
assert.match(job(update, 'commit'), /node ci\/release\.mjs verify/)
assert.match(job(update, 'reconcile'), /always\(\)/)
assert.match(job(update, 'reconcile'), /node ci\/release\.mjs reconcile/)
console.log('Release dependency, checkout, candidate, concurrency and path contracts passed')
