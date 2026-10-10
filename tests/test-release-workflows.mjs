#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const base = readFileSync('.github/workflows/build.yml', 'utf8')
const research = readFileSync('.github/workflows/build-research.yml', 'utf8')
const update = readFileSync('.github/workflows/check-update.yml', 'utf8')

assert.doesNotMatch(base, /^  research:/m, 'Research must not be nested in Standard CI')
for (const token of [
  'name: Queue independent Research release',
  'gh workflow run build-research.yml',
  '--field "base_image=$RELEASE_IMAGE"',
  '--field "source_sha=$SOURCE_SHA"',
  '--field "dsh_version=$RELEASE_VERSION"',
  '--field "channel_tags=$RELEASE_CHANNELS"',
  'steps.publish.outputs.digest',
  'actions: write',
  "github.event_name != 'pull_request' && inputs.preflight_only != true",
]) assert.ok(base.includes(token), 'Standard workflow missing ' + token)

for (const token of [
  'name: Build & Publish Research Image',
  'name: Determine Research build trigger',
  'bash ci/research-push-gate.sh',
  'needs: prepare',
  "needs.prepare.outputs.run_research == 'true'",
  'inputs.source_sha || github.sha',
  'BASE_IMAGE=',
  "- target: research-final",
  "- target: research-economics",
]) assert.ok(research.includes(token), 'Research workflow missing ' + token)

assert.ok(update.includes('uses: ./.github/workflows/build.yml'))
assert.ok(update.includes('actions: write # called Standard workflow dispatches independent Research'))
console.log('Independent Standard / Research workflow shape checks passed')
