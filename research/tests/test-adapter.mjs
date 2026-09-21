import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '..', '..')
const researchRoot = join(repoRoot, 'research')
const workspace = await mkdtemp(join(tmpdir(), 'dsh-research-adapter-'))

process.env.DSH_RESEARCH_WORKSPACE = workspace
process.env.DSH_RESEARCH_BIN_DIR = join(researchRoot, 'bin')
process.env.DSH_RESEARCH_HOME = researchRoot
process.env.PYTHONPATH = [researchRoot, process.env.PYTHONPATH || ''].filter(Boolean).join(':')

try {
  const moduleUrl = pathToFileURL(join(researchRoot, 'adapter', 'index.js'))
  moduleUrl.searchParams.set('test', String(Date.now()))
  const adapter = await import(moduleUrl.href)

  const definitions = new Map()
  const ctx = {
    tools: {
      register(definition) {
        assert.equal(typeof definition.name, 'string')
        assert.equal(typeof definition.execute, 'function')
        assert.equal(definition.parameters?.type, 'object')
        assert.equal(definition.output?.schema?.type, 'object')
        definitions.set(definition.name, definition)
        return () => definitions.delete(definition.name)
      },
    },
  }

  adapter.apply(ctx)

  for (const name of [
    'research_project',
    'research_data',
    'research_pipeline',
    'research_results',
    'economics_did',
    'economics_model',
  ]) {
    assert.ok(definitions.has(name), `missing native tool: ${name}`)
  }

  const exec = { signal: new AbortController().signal }

  const created = await definitions.get('research_project').execute({
    action: 'create',
    slug: 'adapter-smoke',
    title: 'Adapter Smoke',
    template: 'default',
  }, exec)
  assert.equal(created.ok, true)
  assert.match(created.stdout, /Research project created:/)

  const status = await definitions.get('research_project').execute({
    action: 'status',
    project: 'adapter-smoke',
  }, exec)
  assert.equal(status.ok, true)
  assert.equal(status.api?.name, 'dsh-research')
  assert.equal(status.data?.project?.slug, 'adapter-smoke')

  const data = await definitions.get('research_data').execute({
    action: 'list',
    project: 'adapter-smoke',
  }, exec)
  assert.equal(data.ok, true)
  assert.deepEqual(data.data?.datasets, [])

  const pipeline = await definitions.get('research_pipeline').execute({
    action: 'status',
    project: 'adapter-smoke',
  }, exec)
  assert.equal(pipeline.ok, true)
  assert.deepEqual(pipeline.data?.steps, [])

  const results = await definitions.get('research_results').execute({
    action: 'list',
    project: 'adapter-smoke',
  }, exec)
  assert.equal(results.ok, true)
  assert.deepEqual(results.data?.results, [])

  await assert.rejects(
    definitions.get('research_project').execute({
      action: 'status',
      project: '../escape',
    }, exec),
    /inside/,
  )

  console.log('[✓] DSH-native Research Adapter contract passed')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
