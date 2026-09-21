import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, symlink } from 'node:fs/promises'
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

for (const name of [
  'research-init',
  'research-status',
  'research-data',
  'research-pipeline',
  'research-result',
]) {
  await chmod(join(researchRoot, 'bin', name), 0o755)
}
for (const name of ['research-econ-did', 'research-econ-model']) {
  await chmod(join(researchRoot, 'packs', 'economics', 'bin', name), 0o755)
}

try {
  const loadAdapter = async (tag) => {
    const moduleUrl = pathToFileURL(join(researchRoot, 'adapter', 'index.js'))
    moduleUrl.searchParams.set('test', tag)
    return import(moduleUrl.href)
  }

  const makeContext = () => {
    const definitions = new Map()
    const promptSections = new Map()
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
      systemPrompt: {
        section(section) {
          assert.equal(typeof section.name, 'string')
          assert.equal(Number.isFinite(section.order), true)
          assert.equal(typeof section.text, 'string')
          promptSections.set(section.name, section)
          return () => promptSections.delete(section.name)
        },
      },
    }
    return { ctx, definitions, promptSections }
  }

  // Core image: only general Research tools are registered.
  {
    const adapter = await loadAdapter('core-' + Date.now())
    const { ctx, definitions, promptSections } = makeContext()
    adapter.apply(ctx)

    const guidance = promptSections.get('research:native-adapter-guidance')
    assert.ok(guidance, 'missing native Research prompt guidance')
    assert.match(guidance.text, /Prefer research_project/)
    assert.match(guidance.text, /Do not fabricate/)

    for (const name of [
      'research_project',
      'research_data',
      'research_pipeline',
      'research_results',
    ]) {
      assert.ok(definitions.has(name), `missing native tool: ${name}`)
    }
    assert.equal(definitions.has('economics_did'), false)
    assert.equal(definitions.has('economics_model'), false)

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

    const outside = await mkdtemp(join(tmpdir(), 'dsh-research-adapter-outside-'))
    await symlink(outside, join(workspace, 'escape-link'))
    await assert.rejects(
      definitions.get('research_project').execute({
        action: 'status',
        project: 'escape-link',
      }, exec),
      /physically inside/,
    )
    await rm(outside, { recursive: true, force: true })
  }

  // Economics/custom images may expose additional backends through the
  // compatibility search path rather than the Core bin directory.
  {
    const econBin = await mkdtemp(join(tmpdir(), 'dsh-research-econ-bin-'))
    try {
      for (const name of [
        'research-init',
        'research-status',
        'research-data',
        'research-pipeline',
        'research-result',
      ]) {
        await symlink(join(researchRoot, 'bin', name), join(econBin, name))
      }
      for (const name of ['research-econ-did', 'research-econ-model']) {
        await symlink(
          join(researchRoot, 'packs', 'economics', 'bin', name),
          join(econBin, name),
        )
      }

      process.env.DSH_RESEARCH_BIN_DIR = join(researchRoot, 'bin')
      process.env.DSH_RESEARCH_BIN_PATH = econBin
      const adapter = await loadAdapter('economics-' + Date.now())
      const { ctx, definitions } = makeContext()
      adapter.apply(ctx)

      for (const name of [
        'research_project',
        'research_data',
        'research_pipeline',
        'research_results',
        'economics_did',
        'economics_model',
      ]) {
        assert.ok(definitions.has(name), `missing native economics tool: ${name}`)
      }
    } finally {
      delete process.env.DSH_RESEARCH_BIN_PATH
      await rm(econBin, { recursive: true, force: true })
    }
  }

  // PATH remains a final compatibility fallback for development/custom images.
  {
    const pathBin = await mkdtemp(join(tmpdir(), 'dsh-research-path-bin-'))
    const originalPath = process.env.PATH || ''
    try {
      for (const name of [
        'research-init',
        'research-status',
        'research-data',
        'research-pipeline',
        'research-result',
      ]) {
        await symlink(join(researchRoot, 'bin', name), join(pathBin, name))
      }
      for (const name of ['research-econ-did', 'research-econ-model']) {
        await symlink(
          join(researchRoot, 'packs', 'economics', 'bin', name),
          join(pathBin, name),
        )
      }

      delete process.env.DSH_RESEARCH_BIN_DIR
      delete process.env.DSH_RESEARCH_BIN_PATH
      process.env.PATH = [pathBin, originalPath].filter(Boolean).join(':')
      const adapter = await loadAdapter('path-fallback-' + Date.now())
      const { ctx, definitions } = makeContext()
      adapter.apply(ctx)

      assert.ok(definitions.has('research_project'))
      assert.ok(definitions.has('economics_did'))
      assert.ok(definitions.has('economics_model'))
    } finally {
      process.env.PATH = originalPath
      process.env.DSH_RESEARCH_BIN_DIR = join(researchRoot, 'bin')
      await rm(pathBin, { recursive: true, force: true })
    }
  }

  console.log('[✓] DSH-native Research Adapter contract passed')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
