import { existsSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export const name = 'dsh-research-adapter'
export const inject = ['tools', 'systemPrompt']

const WORKSPACE = resolve(process.env.DSH_RESEARCH_WORKSPACE || '/workspace')
const WORKSPACE_REAL = existsSync(WORKSPACE) ? realpathSync(WORKSPACE) : WORKSPACE
const BIN_DIR = process.env.DSH_RESEARCH_BIN_DIR || '/usr/local/bin'
const MAX_CAPTURE = 64 * 1024

function jsonOutput() {
  return {
    schema: {
      type: 'object',
      additionalProperties: true,
    },
    render: (_args, value) => [{
      type: 'text',
      text: JSON.stringify(value, null, 2),
    }],
  }
}

function schema(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

function inside(base, path) {
  const rel = relative(base, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

function physicalCandidate(path) {
  if (existsSync(path)) return realpathSync(path)

  let ancestor = path
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }

  if (!existsSync(ancestor)) return path
  const physicalAncestor = realpathSync(ancestor)
  return resolve(physicalAncestor, relative(ancestor, path))
}

function resolveWorkspacePath(value = '.') {
  const candidate = resolve(isAbsolute(value) ? value : resolve(WORKSPACE, value))
  if (!inside(WORKSPACE, candidate) || !inside(WORKSPACE_REAL, physicalCandidate(candidate))) {
    throw new Error(`path must stay physically inside ${WORKSPACE}: ${value}`)
  }
  return candidate
}

function projectRoot(value = '.') {
  const root = resolveWorkspacePath(value)
  if (!existsSync(resolve(root, 'research.yaml'))) {
    throw new Error(`research.yaml not found in project: ${root}`)
  }
  return root
}

function commandPath(name) {
  const candidate = resolve(BIN_DIR, name)
  return existsSync(candidate) ? candidate : name
}

function cleanEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(key)) {
      delete env[key]
    }
  }
  return env
}

function requireText(args, key) {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`)
  }
  return value.trim()
}

function pushOption(argv, flag, value) {
  if (value === undefined || value === null || value === '') return
  argv.push(flag, String(value))
}

function runCli(name, argv, { cwd, signal, timeoutMs = 120000, expectJson = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(commandPath(name), argv, {
      cwd: cwd || WORKSPACE,
      env: cleanEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    })

    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false

    const collect = (kind, chunk) => {
      const text = chunk.toString('utf8')
      if (kind === 'stdout') {
        if (stdout.length < MAX_CAPTURE) stdout += text.slice(0, MAX_CAPTURE - stdout.length)
        else stdoutTruncated = true
      } else {
        if (stderr.length < MAX_CAPTURE) stderr += text.slice(0, MAX_CAPTURE - stderr.length)
        else stderrTruncated = true
      }
    }

    child.stdout.on('data', chunk => collect('stdout', chunk))
    child.stderr.on('data', chunk => collect('stderr', chunk))

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
    }, timeoutMs)

    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', code => {
      clearTimeout(timer)
      const exitCode = code ?? 1
      const out = stdout.trim()
      const err = stderr.trim()

      if (expectJson) {
        let payload
        try {
          payload = JSON.parse(out)
        } catch {
          resolvePromise({
            ok: false,
            adapter_error: {
              code: 'INVALID_JSON',
              message: `${name} did not return Stable JSON API output`,
            },
            command: [name, ...argv],
            exit_code: exitCode,
            stdout: out,
            stderr: err,
            truncated: stdoutTruncated || stderrTruncated,
          })
          return
        }
        resolvePromise({
          ...payload,
          adapter: {
            command: [name, ...argv],
            exit_code: exitCode,
            truncated: stdoutTruncated || stderrTruncated,
          },
        })
        return
      }

      resolvePromise({
        ok: exitCode === 0,
        command: [name, ...argv],
        exit_code: exitCode,
        stdout: out,
        stderr: err,
        truncated: stdoutTruncated || stderrTruncated,
      })
    })
  })
}

async function runJson(name, argv, project, exec, timeoutMs) {
  return runCli(name, argv, {
    cwd: projectRoot(project),
    signal: exec?.signal,
    timeoutMs,
    expectJson: true,
  })
}

function register(ctx, definition) {
  ctx.tools.register({
    ...definition,
    output: jsonOutput(),
  })
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'research:native-adapter-guidance',
    order: 160,
    interpolate: false,
    text: [
      'DSH Research Edition is available through native Research tools.',
      'Prefer research_project, research_data, research_pipeline, and research_results over manually constructing research-* shell commands.',
      'When Economics tools are available, prefer economics_did and economics_model over manually constructing research-econ-* commands.',
      'Treat research-* CLI commands as backend/debugging interfaces unless the user explicitly asks for CLI instructions.',
      'Inspect the research question, design, project status, data lineage, and stale/current state before executing analysis.',
      'Do not fabricate datasets, citations, coefficients, p-values, robustness results, or completed runs.',
      'A real pipeline run or econometric estimate should follow the user\'s research intent; inspection and dry-run are preferred before execution when scope is unclear.',
    ].join(' '),
  })

  register(ctx, {
    name: 'research_project',
    description:
      'High-level DSH Research project tool. Use this instead of shelling out to research-* commands. ' +
      'Actions: create a reproducible project, inspect project status, run research checks, or evaluate release readiness. ' +
      'For create, never overwrite a non-empty destination. For status/check/release, project must contain research.yaml.',
    parameters: schema({
      action: {
        type: 'string',
        enum: ['create', 'status', 'check', 'release'],
        description: 'Project operation.',
      },
      project: {
        type: 'string',
        description: 'Project path relative to /workspace, or an absolute path inside /workspace. Defaults to current workspace.',
      },
      slug: { type: 'string', description: 'New project slug for action=create.' },
      title: { type: 'string', description: 'Human-readable project title for action=create.' },
      template: {
        type: 'string',
        enum: ['default', 'economics'],
        description: 'Project template for action=create.',
      },
      mode: {
        type: 'string',
        enum: ['quick', 'full'],
        description: 'Check mode for action=check. Defaults to full.',
      },
    }, ['action']),
    async execute(args, exec) {
      if (args.action === 'create') {
        const slug = requireText(args, 'slug')
        const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : slug
        const template = args.template || 'default'
        const destination = resolveWorkspacePath(args.project || slug)
        const argv = ['--template', template, slug, title, destination]
        return runCli('research-init', argv, {
          cwd: WORKSPACE,
          signal: exec?.signal,
          timeoutMs: 120000,
        })
      }

      const project = args.project || '.'
      if (args.action === 'status') {
        return runJson('research-status', ['--json'], project, exec)
      }
      if (args.action === 'release') {
        return runJson('research-check', ['--release', '--json'], project, exec)
      }
      const mode = args.mode || 'full'
      const argv = mode === 'quick' ? ['--quick', '--json'] : ['--json']
      return runJson('research-check', argv, project, exec)
    },
  })

  register(ctx, {
    name: 'research_data',
    description:
      'Manage the DSH Research Dataset Catalog and lineage without editing manifests by hand. ' +
      'Use register after data appears in a project; use verify/lineage to diagnose stale data.',
    parameters: schema({
      action: {
        type: 'string',
        enum: ['register', 'list', 'verify', 'lineage'],
      },
      project: { type: 'string', description: 'Research project path inside /workspace.' },
      path: { type: 'string', description: 'Dataset file path relative to the project for register.' },
      name: { type: 'string', description: 'Stable Dataset id.' },
      kind: {
        type: 'string',
        enum: ['raw', 'processed', 'interim', 'external'],
      },
      input: {
        type: 'array',
        items: { type: 'string' },
        description: 'Registered upstream Dataset ids for lineage.',
      },
      code: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project-relative code files that produced this Dataset.',
      },
      pipeline_step: { type: 'string' },
      run_id: { type: 'string' },
      force: { type: 'boolean', description: 'Refresh an existing Dataset manifest.' },
    }, ['action']),
    async execute(args, exec) {
      const project = args.project || '.'
      if (args.action === 'list') return runJson('research-data', ['list', '--json'], project, exec)
      if (args.action === 'verify') {
        const argv = ['verify']
        if (args.name) argv.push(args.name)
        argv.push('--json')
        return runJson('research-data', argv, project, exec)
      }
      if (args.action === 'lineage') {
        const name = requireText(args, 'name')
        return runJson('research-data', ['lineage', name, '--json'], project, exec)
      }

      const path = requireText(args, 'path')
      const name = requireText(args, 'name')
      const kind = requireText(args, 'kind')
      const argv = ['register', path, '--name', name, '--kind', kind]
      for (const item of args.input || []) pushOption(argv, '--input', item)
      for (const item of args.code || []) pushOption(argv, '--code', item)
      pushOption(argv, '--pipeline-step', args.pipeline_step)
      pushOption(argv, '--run-id', args.run_id)
      if (args.force) argv.push('--force')
      argv.push('--json')
      return runJson('research-data', argv, project, exec)
    },
  })

  register(ctx, {
    name: 'research_pipeline',
    description:
      'Inspect or execute a DSH Research Pipeline DAG. Prefer status/explain first. ' +
      'run defaults to dry-run=true; set dry_run=false only when the user explicitly asks to execute research code.',
    parameters: schema({
      action: {
        type: 'string',
        enum: ['status', 'explain', 'run'],
      },
      project: { type: 'string' },
      step: { type: 'string', description: 'Pipeline step for explain or targeted run.' },
      dry_run: {
        type: 'boolean',
        description: 'For action=run. Defaults to true.',
      },
      force: {
        type: 'boolean',
        description: 'Force rerun selected steps. Use sparingly.',
      },
    }, ['action']),
    async execute(args, exec) {
      const project = args.project || '.'
      if (args.action === 'status') {
        return runJson('research-pipeline', ['status', '--json'], project, exec)
      }
      if (args.action === 'explain') {
        const step = requireText(args, 'step')
        return runJson('research-pipeline', ['explain', step, '--json'], project, exec)
      }
      const argv = ['run']
      if (args.step) argv.push(args.step)
      if (args.dry_run !== false) argv.push('--dry-run')
      if (args.force) argv.push('--force')
      argv.push('--json')
      return runJson('research-pipeline', argv, project, exec, 10 * 60 * 1000)
    },
  })

  register(ctx, {
    name: 'research_results',
    description:
      'Inspect the unified DSH Research Result Registry. Use list/show to understand current results and verify to detect stale/missing artifacts.',
    parameters: schema({
      action: {
        type: 'string',
        enum: ['list', 'show', 'verify'],
      },
      project: { type: 'string' },
      result_id: { type: 'string' },
      result_type: { type: 'string', description: 'Optional filter for list.' },
    }, ['action']),
    async execute(args, exec) {
      const project = args.project || '.'
      if (args.action === 'list') {
        const argv = ['list']
        pushOption(argv, '--type', args.result_type)
        argv.push('--json')
        return runJson('research-result', argv, project, exec)
      }
      if (args.action === 'show') {
        const id = requireText(args, 'result_id')
        return runJson('research-result', ['show', id, '--json'], project, exec)
      }
      const argv = ['verify']
      if (args.result_id) argv.push(args.result_id)
      argv.push('--json')
      return runJson('research-result', argv, project, exec)
    },
  })

  if (existsSync(commandPath('research-econ-did'))) {
    register(ctx, {
      name: 'economics_did',
      description:
        'Economics Research Pack tool for Difference-in-Differences / Event Study. ' +
        'Always use action=check before estimate. Do not interpret a coefficient as causal unless the research design supports it. ' +
        'estimate writes traceable DiD artifacts and should only be used after the user agrees on the design.',
      parameters: schema({
        action: { type: 'string', enum: ['check', 'estimate'] },
        project: { type: 'string' },
        name: { type: 'string' },
        data: { type: 'string' },
        outcome: { type: 'string' },
        id: { type: 'string' },
        time: { type: 'string' },
        cohort: { type: 'string' },
        treatment: { type: 'string' },
        never_treated: { type: 'string', description: 'Never-treated cohort code. Defaults to 0.' },
        title: { type: 'string' },
        cluster: { type: 'string' },
        controls: { type: 'string' },
        estimator: {
          type: 'string',
          enum: ['twfe', 'did2s', 'saturated', 'lpdid'],
        },
        mode: { type: 'string', enum: ['dynamic', 'att'] },
        pre_window: { type: 'integer' },
        post_window: { type: 'integer' },
      }, ['action', 'name', 'data', 'outcome', 'id', 'time', 'cohort']),
      async execute(args, exec) {
        const project = projectRoot(args.project || '.')
        const argv = [
          args.action,
          '--name', requireText(args, 'name'),
          '--data', requireText(args, 'data'),
          '--outcome', requireText(args, 'outcome'),
          '--id', requireText(args, 'id'),
          '--time', requireText(args, 'time'),
          '--cohort', requireText(args, 'cohort'),
        ]
        pushOption(argv, '--treatment', args.treatment)
        pushOption(argv, '--never-treated', args.never_treated || '0')
        if (args.action === 'estimate') {
          pushOption(argv, '--title', args.title)
          pushOption(argv, '--cluster', requireText(args, 'cluster'))
          pushOption(argv, '--controls', args.controls)
          pushOption(argv, '--estimator', requireText(args, 'estimator'))
          pushOption(argv, '--mode', args.mode || 'dynamic')
          pushOption(argv, '--pre-window', args.pre_window)
          pushOption(argv, '--post-window', args.post_window)
        }
        return runCli('research-econ-did', argv, {
          cwd: project,
          signal: exec?.signal,
          timeoutMs: 10 * 60 * 1000,
        })
      },
    })
  }

  if (existsSync(commandPath('research-econ-model'))) {
    register(ctx, {
      name: 'economics_model',
      description:
        'Economics Research Pack tool for a traceable linear/fixed-effects regression. ' +
        'Requires an explicit variance estimator. Use after the estimand, specification, fixed effects, and clustering are defined.',
      parameters: schema({
        project: { type: 'string' },
        name: { type: 'string' },
        data: { type: 'string' },
        formula: { type: 'string' },
        title: { type: 'string' },
        vcov: {
          type: 'string',
          enum: ['iid', 'hetero', 'HC1', 'HC2', 'HC3', 'cluster', 'CRV1', 'CRV3'],
        },
        cluster: { type: 'string' },
        focus: { type: 'array', items: { type: 'string' } },
      }, ['name', 'data', 'formula', 'vcov']),
      async execute(args, exec) {
        const project = projectRoot(args.project || '.')
        const argv = [
          'feols',
          '--name', requireText(args, 'name'),
          '--data', requireText(args, 'data'),
          '--formula', requireText(args, 'formula'),
          '--vcov', requireText(args, 'vcov'),
        ]
        pushOption(argv, '--title', args.title)
        pushOption(argv, '--cluster', args.cluster)
        for (const term of args.focus || []) pushOption(argv, '--focus', term)
        return runCli('research-econ-model', argv, {
          cwd: project,
          signal: exec?.signal,
          timeoutMs: 10 * 60 * 1000,
        })
      },
    })
  }
}
