/** Reverse Workbench v2: durable, strictly scoped project catalog. No sample execution. */
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, readdirSync, writeFileSync, unlinkSync, fsyncSync } from 'node:fs'
import { resolve, join } from 'node:path'
const ROOT = resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT || '/workspace')
const DIRECTORY = join(ROOT, '.reverse-projects')
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX = 100
function directory() {
  if (lstatSync(ROOT).isSymbolicLink() || !lstatSync(ROOT).isDirectory()) throw Error('unsafe workspace')
  if (!existsSync(DIRECTORY)) mkdirSync(DIRECTORY, {mode:0o700})
  if (lstatSync(DIRECTORY).isSymbolicLink() || !lstatSync(DIRECTORY).isDirectory()) throw Error('unsafe project registry')
  return DIRECTORY
}
function filename(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw Error('invalid project id')
  return join(directory(), id + '.json')
}
function atomic(path, data) {
  const temp = join(directory(), '.' + randomUUID() + '.tmp')
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2) + '\n')
    fsyncSync(fd)
    closeSync(fd)
    renameSync(temp, path)
  } catch (error) {
    try { closeSync(fd) } catch {}
    try { unlinkSync(temp) } catch {}
    throw error
  }
}
function validate(source, expected) {
  if (!source || source.schema !== 'dsh-reverse-project/v1' || source.id !== expected ||
      typeof source.name !== 'string' || source.name.length < 1 ||
      source.name.length > 80 || typeof source.created_at !== 'string')
    throw Error('invalid project record')
  return {schema:source.schema,id:source.id,name:source.name,
    description:typeof source.description==='string' ? source.description.slice(0,500) : '',
    created_at:source.created_at}
}
export function projects() {
  return readdirSync(directory()).filter(s=>ID.test(s.slice(0,-5))&&s.endsWith('.json'))
    .slice(0,MAX).flatMap(entry=>{
      try {return [project(entry.slice(0,-5))]} catch {return []}
    }).sort((a,b)=>b.created_at.localeCompare(a.created_at))
}
export function project(id) {
  const path=filename(id)
  const stat=lstatSync(path)
  if (!stat.isFile() || stat.size>2048) throw Error('unsafe project file')
  return validate(JSON.parse(readFileSync(path,'utf8')),id)
}
export function createProject(name, description='') {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80 ||
      typeof description !== 'string' || description.length > 500)
    throw Error('invalid project details')
  if (projects().length >= MAX) throw Error('project capacity reached')
  const id=randomUUID()
  const result=validate({schema:'dsh-reverse-project/v1',id,name:name.trim(),
    description,created_at:new Date().toISOString()},id)
  atomic(filename(id),result)
  return result
}
