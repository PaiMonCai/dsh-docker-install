import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const expectedVersion = process.argv[2] ?? '6.7.0'
const entry = process.argv[3] ? resolve(process.argv[3]) : null
const root = mkdtempSync(join(tmpdir(), 'dsh-rea-smoke-'))
const app = join(root, 'app')
mkdirSync(app)
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'rea-static-smoke', version: '1.0.0', main: 'index.js' }))
writeFileSync(join(app, 'index.js'), 'exports.double = value => value * 2;\nthrow new Error("REA_SMOKE_MUST_NOT_EXECUTE");\n')
const child = spawn(entry ? process.execPath : 'rea', entry ? [entry, 'mcp'] : ['mcp'], {
  cwd: root,
  env: { ...process.env, REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})
const pending = new Map()
let nextId = 0
let failure = null
let stderr = ''
function fail(error) {
  failure = error
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}
child.on('error', fail)
child.stdin.on('error', fail)
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000) })
const closed = new Promise(resolveClosed => child.on('close', (code, signal) => {
  fail(Error(`REA closed: code=${code} signal=${signal}`))
  resolveClosed()
}))
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  try {
    const message = JSON.parse(line)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  } catch (error) { fail(error) }
})
function request(method, params) {
  if (failure) return Promise.reject(failure)
  return new Promise((resolveResult, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Error(`REA MCP timeout: ${method}`))
    }, 45000)
    pending.set(id, {
      resolve: result => { clearTimeout(timer); resolveResult(result) },
      reject: error => { clearTimeout(timer); reject(error) },
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
try {
  const initialized = await request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-rea-smoke', version: '1.0.0' },
  })
  assert.equal(initialized.serverInfo.version, expectedVersion)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const tools = new Map()
  const cursors = new Set()
  let cursor
  do {
    const page = await request('tools/list', cursor ? { cursor } : {})
    for (const tool of page.tools) {
      assert.ok(!tools.has(tool.name), `Duplicate tool: ${tool.name}`)
      assert.ok(Buffer.byteLength(JSON.stringify(tool.inputSchema)) <= 13312, `Oversized compact schema: ${tool.name}`)
      tools.set(tool.name, tool)
    }
    cursor = page.nextCursor
    if (cursor) {
      assert.ok(!cursors.has(cursor), 'Repeated tool-list cursor')
      cursors.add(cursor)
    }
  } while (cursor)
  for (const name of ['binary_session', 'open_binary', 'analyze_javascript_application', 'inspect_analysis_view'])
    assert.ok(tools.has(name), `Missing REA tool: ${name}`)
  const analysis = await request('tools/call', {
    name: 'analyze_javascript_application', arguments: { input_path: app, format: 'directory', detail: 'summary' },
  })
  assert.ok(!analysis.isError, JSON.stringify(analysis))
  const text = analysis.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  const result = JSON.parse(text)
  assert.ok(result.normalized_result, 'Missing static-analysis result')
  assert.match(result.evidence_id, /^ev_[a-f0-9]{64}$/)
  assert.ok(Object.hasOwn(result, 'relationship_coverage'), 'Missing explicit relationship coverage')
  assert.equal(result.normalized_result.kind, 'summary')
  assert.match(result.normalized_result.parent_evidence_id, /^ev_[a-f0-9]{64}$/)
  assert.equal(result.normalized_result.summary.statistics.parsed_javascript_files, 1)
  assert.equal(result.normalized_result.summary.statistics.parse_failures, 0)
  // Retained Evidence must remain readable without reopening the analyzed source.
  rmSync(app, { recursive: true, force: true })
  const retained = await request('tools/call', {
    name: 'inspect_analysis_view', arguments: {
      source: { kind: 'retained-evidence', evidence_id: result.normalized_result.parent_evidence_id },
      view: { kind: 'summary' },
    },
  })
  assert.ok(!retained.isError, JSON.stringify(retained))
  const view = JSON.parse(retained.content.filter(item => item.type === 'text').map(item => item.text).join('\n'))
  assert.equal(view.normalized_result.parent_evidence_id, result.normalized_result.parent_evidence_id)
  assert.equal(view.normalized_result.summary.statistics.parsed_javascript_files, 1)
  console.log('DSH_REA_MCP_SMOKE_PASS ' + JSON.stringify({ version: expectedVersion, tools: tools.size,
    compactSchemas: true, staticAnalysis: true, retainedEvidence: true }))
} catch (error) {
  throw Error(`${error.message}\n${stderr}`, { cause: error })
} finally {
  child.stdin.end()
  const kill = setTimeout(() => child.kill('SIGKILL'), 2000)
  await closed
  clearTimeout(kill)
  lines.close()
  rmSync(root, { recursive: true, force: true })
}
