/** Read-only Reverse Workbench data access, bounded to workspace evidence and task files. */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative, isAbsolute, sep } from 'node:path'
const ROOT = resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT || '/workspace')
const TASKS = join(ROOT, '.reverse-tasks')
const MAX_REPORT = 8 * 1024 * 1024
const MAX_TASK = 30000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const KNOWN = new Set(['dsh-reverse-evidence/v1','dsh-reverse-ghidra/v2',
  'dsh-reverse-js-triage/v1','dsh-reverse-diff/v1','dsh-reverse-workspace/v1',
  'dsh-reverse-case/v1'])
function workspaceFile(value, maxBytes) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0'))
    throw Error('invalid workspace relative path')
  if (isAbsolute(value) || value.split(/[\\/]/).includes('..'))
    throw Error('workspace paths must be relative')
  const file = resolve(ROOT, value)
  const rel = relative(ROOT, file)
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
    throw Error('outside workspace')
  // Reject intermediate symlinks too; lstat on every existing segment.
  let cursor = ROOT
  if (lstatSync(ROOT).isSymbolicLink()) throw Error('unsafe workspace root')
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    const stat = lstatSync(cursor)
    if (stat.isSymbolicLink()) throw Error('symlink path is not allowed')
  }
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes)
    throw Error('file unavailable or exceeds read cap')
  return file
}
function parseFile(file, bytes) { return JSON.parse(readFileSync(file, 'utf8')) }
export function tasks() {
  if (!existsSync(TASKS)) return []
  if (lstatSync(TASKS).isSymbolicLink() || !lstatSync(TASKS).isDirectory())
    throw Error('unsafe tasks directory')
  const entries = readdirSync(TASKS)
    .filter(x => x.endsWith('.json') && UUID.test(x.slice(0, -5))).slice(0, 300)
  const rows = []
  for (const entry of entries) {
    try {
      const item = parseFile(workspaceFile('.reverse-tasks/' + entry, MAX_TASK), MAX_TASK)
      if (item.schema !== 'dsh-reverse-task/v1' || item.id !== entry.slice(0, -5)) continue
      rows.push({ id: item.id, kind: item.kind, state: item.state,
        attempts: item.attempts, created_at: item.created_at,
        updated_at: item.updated_at, error: item.last_error })
    } catch { /* ignore corrupt records, no disruption to UI */ }
  }
  return rows.sort((a,b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 100)
}
export function taskDetail(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw Error('invalid task id')
  const data = parseFile(workspaceFile('.reverse-tasks/' + id + '.json', MAX_TASK))
  if (data.schema !== 'dsh-reverse-task/v1' || data.id !== id) throw Error('invalid task record')
  // Never display arbitrary command arguments or raw tool logs to Web clients.
  return { id:data.id, kind:data.kind, state:data.state, attempts:data.attempts,
    created_at:data.created_at, updated_at:data.updated_at, error:data.last_error,
    exit_code:data.result?.exit_code ?? null }
}
export function report(path) {
  const data = parseFile(workspaceFile(path, MAX_REPORT))
  if (!data || !KNOWN.has(data.schema)) throw Error('unrecognized report schema')
  if (data.schema === 'dsh-reverse-ghidra/v2') {
    const nodes = (Array.isArray(data.call_graph?.nodes) ? data.call_graph.nodes : [])
      .slice(0, 200).map(x => ({ address:String(x.address).slice(0,80), name:String(x.name).slice(0,160) }))
    const edges = (Array.isArray(data.call_graph?.edges) ? data.call_graph.edges : [])
      .slice(0, 2000).map(x => ({source:String(x.source).slice(0,80),target:String(x.target).slice(0,80)}))
    const functions = (Array.isArray(data.functions) ? data.functions : []).slice(0,200)
      .map(x => ({address:String(x.address).slice(0,80),name:String(x.name).slice(0,160),
        signature:String(x.signature || '').slice(0,500),pseudocode:String(x.pseudocode || '').slice(0,4000)}))
    const known = new Set(nodes.map(n => n.address))
    const safeEdges = edges.filter(e => known.has(e.source) && known.has(e.target))
    const refs = (Array.isArray(data.references?.entries) ? data.references.entries : [])
      .slice(0, 2000).map(r => ({target:String(r.target).slice(0,80),
        from:String(r.from).slice(0,80), type:String(r.type).slice(0,80)}))
      .filter(r => known.has(r.target))
    return { schema:data.schema, program:String(data.program || '').slice(0,180), nodes,
      edges:safeEdges, references:refs, functions,
      graph_truncated: Boolean(data.call_graph?.truncated),
      limitations:Array.isArray(data.limitations) ? data.limitations.slice(0,20) : [] }
  }
  if (data.schema === 'dsh-reverse-case/v1') {
    // Case bodies are untrusted analysis notes; expose only bounded metadata.
    return {
      schema:data.schema,id:String(data.id||'').slice(0,40),
      revision:Number.isSafeInteger(data.revision)?data.revision:0,
      gates:Object.fromEntries(['G1','G2','G3','G4'].map(g=>
        [g,['pending','passed','blocked'].includes(data.gates?.[g]?.state) ? data.gates[g].state : 'unknown'])),
      evidence_count:Array.isArray(data.evidence)?Math.min(data.evidence.length,100):0,
      hypothesis_count:Array.isArray(data.hypotheses)?Math.min(data.hypotheses.length,100):0,
      experiment_count:Array.isArray(data.experiments)?Math.min(data.experiments.length,100):0
    }
  }
  if (data.schema === 'dsh-reverse-workspace/v1') {
    const entries=Array.isArray(data.reports)?data.reports:[]
    return {schema:data.schema,reports:entries.slice(0,100).map(x=>({
      path:String(x.path).slice(0,1024),schema:String(x.schema).slice(0,100),
      sha256:String(x.sha256).slice(0,64),size:x.size}))}
  }
  if (data.schema === 'dsh-reverse-evidence/v1') {
    return {schema:data.schema,sample:data.sample,analysis:data.analysis,
      evidence:(data.evidence || []).slice(0,100),warnings:(data.warnings || []).slice(0,100)}
  }
  if (data.schema === 'dsh-reverse-js-triage/v1') {
    return {schema:data.schema,files_scanned:data.files_scanned,
      entries:(data.entries || []).slice(0,250),warnings:(data.warnings || []).slice(0,100)}
  }
  return {schema:data.schema,functions_added:data.functions_added,functions_removed:data.functions_removed,
    functions_modified:data.functions_modified,edges_added:data.edges_added,edges_removed:data.edges_removed}
}


/** Validate a stored manifest's evidence provenance before exposing browse links. */
export function manifest(path) {
  const item = report(path)
  if (item.schema !== 'dsh-reverse-workspace/v1') throw Error('expected evidence index')
  let totalBytes = 0
  const records = item.reports.map(row => {
    try {
      if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw Error('bad digest')
      const source = workspaceFile(row.path, MAX_REPORT)
      const length = lstatSync(source).size
      if (totalBytes + length > 32 * 1024 * 1024) throw Error('manifest read cap reached')
      totalBytes += length
      const bytes = readFileSync(source)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const parsed = JSON.parse(bytes.toString('utf8'))
      const verified = bytes.length === row.size && hash === row.sha256 &&
        parsed?.schema === row.schema && KNOWN.has(parsed.schema)
      return { path:row.path, schema:row.schema, size:row.size, verified }
    } catch {
      return { path:row.path, schema:row.schema, size:row.size, verified:false }
    }
  })
  return { schema:'dsh-reverse-workspace-navigation/v1',
    total:records.length, verified:records.filter(x=>x.verified).length, reports:records }
}


/** Read-only case metadata; no arbitrary command outputs, observations or secrets. */
const CASES=join(ROOT,'.reverse-cases')
const MAX_CASE=256*1024
export function cases(){
  if(!existsSync(CASES))return []
  if(lstatSync(CASES).isSymbolicLink()||!lstatSync(CASES).isDirectory())
    throw Error('unsafe cases directory')
  const list=[]
  for(const entry of readdirSync(CASES).filter(x=>x.endsWith('.json')&&UUID.test(x.slice(0,-5))).slice(0,300)){
    try{
      const item=caseRecord(entry.slice(0,-5))
      list.push({id:item.id,goal:String(item.goal).slice(0,200),
        updated_at:item.updated_at,revision:item.revision,
        evidence_count:item.evidence.length,hypothesis_count:item.hypotheses.length})
    }catch{/* invalid cases cannot pollute the UI */}
  }
  return list.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,100)
}
function caseRecord(id){
  if(typeof id!=='string'||!UUID.test(id))throw Error('invalid case id')
  const item=parseFile(workspaceFile('.reverse-cases/'+id+'.json',MAX_CASE))
  if(item.schema!=='dsh-reverse-case/v1'||item.id!==id ||
     !Array.isArray(item.evidence)||!Array.isArray(item.hypotheses)||
     !Array.isArray(item.experiments)||!Array.isArray(item.tasks))
    throw Error('invalid case record')
  return item
}
export function caseDetail(id){
  const item=caseRecord(id)
  const gates={}
  for(const name of ['G1','G2','G3','G4'])
    gates[name]=['pending','passed','blocked'].includes(item.gates?.[name]?.state)
      ? item.gates[name].state:'unknown'
  return {schema:item.schema,id:item.id,revision:item.revision,
    goal:String(item.goal).slice(0,300),deliverable:String(item.deliverable).slice(0,200),
    updated_at:item.updated_at,gates,
    evidence:item.evidence.slice(0,100).map(e=>({
      id:String(e.id).slice(0,16),grade:String(e.grade).slice(0,30),
      artifact_path:String(e.artifact?.path||'').slice(0,500)
    })),
    hypotheses:item.hypotheses.slice(0,100).map(h=>({
      id:String(h.id).slice(0,16),state:String(h.state).slice(0,40),
      evidence_ids:Array.isArray(h.evidence_ids)?h.evidence_ids.slice(0,100):[]
    })),
    experiments:item.experiments.slice(0,100).map(e=>({
      id:String(e.id).slice(0,16),state:String(e.state).slice(0,40),
      hypothesis_id:String(e.hypothesis_id).slice(0,16),
      evidence_ids:Array.isArray(e.evidence_ids)?e.evidence_ids.slice(0,100)
        .filter(id=>typeof id==='string').map(id=>id.slice(0,16)):[]
    })),
    tasks:item.tasks.slice(0,100).map(t=>({
      id:String(t.id).slice(0,40),kind:String(t.kind).slice(0,40),state:String(t.state).slice(0,40)
    }))
  }
}
