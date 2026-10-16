/** Offline, read-only knowledge router. Built-in patterns are references, never executable instructions. */
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILTIN=fileURLToPath(new URL('../../knowledge/patterns.json',import.meta.url))
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
const NOTES=join(ROOT,'.reverse-knowledge')
const ID=/^[a-z][a-z0-9-]{2,79}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PLATFORMS=new Set(['all','android','elf','pe','macho','javascript','electron','web','network','firmware','wasm'])
const MAX_NOTES=100,MAX_NOTE_BYTES=8192,MAX_BUILTIN=128*1024
function text(value,max){return typeof value==='string'?value.slice(0,max):''}
function strings(values,maxCount,maxLength){
  return Array.isArray(values)?values.slice(0,maxCount).filter(v=>typeof v==='string').map(v=>v.slice(0,maxLength)):[]
}
function clean(item,origin){
  if(!item||!ID.test(item.id)||!Array.isArray(item.platforms)||!item.platforms.length)
    throw Error('invalid knowledge pattern')
  return {
    id:item.id,origin,
    title:text(item.title,100),summary:text(item.summary,400),
    platforms:strings(item.platforms,8,30),
    signals:strings(item.signals,16,80),
    checks:strings(item.checks,10,260),
    alternatives:strings(item.alternatives,10,260),
    route:text(item.route,80),
    verification:text(item.verification,500),
    limitations:text(item.limitations,500),
    confidence:origin==='curated'?'reference-only':'case-derived-unverified',
    source:origin==='curated'?'bundled-reference':'operator-promoted-case',
    case_id:origin==='user-case'?text(item.case_id,40):null,
    evidence_ids:origin==='user-case'?strings(item.evidence_ids,24,20):[],
  }
}
function builtin(){
  const data=readFileSync(BUILTIN)
  if(data.length>MAX_BUILTIN)throw Error('bundled knowledge index is too large')
  const json=JSON.parse(data.toString('utf8'))
  if(json.schema!=='dsh-reverse-knowledge/v1'||!Array.isArray(json.entries)||json.entries.length>100)
    throw Error('invalid bundled knowledge catalog')
  const rows=json.entries.map(e=>clean(e,'curated'))
  if(new Set(rows.map(e=>e.id)).size!==rows.length)throw Error('duplicate pattern id')
  return rows
}
function userNotes(){
  if(!existsSync(NOTES))return []
  if(lstatSync(NOTES).isSymbolicLink()||!lstatSync(NOTES).isDirectory())
    throw Error('unsafe reverse knowledge directory')
  const out=[]
  const list=readdirSync(NOTES).filter(x=>/^case-[0-9a-f-]{36}\.json$/.test(x)).slice(0,MAX_NOTES)
  for(const name of list){
    try{
      const f=join(NOTES,name),st=lstatSync(f)
      if(st.isSymbolicLink()||!st.isFile()||st.size<=0||st.size>MAX_NOTE_BYTES)continue
      const raw=JSON.parse(readFileSync(f,'utf8'))
      if(raw.schema!=='dsh-reverse-learning/v1'||raw.id+'.json'!==name||!UUID.test(raw.case_id))continue
      out.push(clean(raw,'user-case'))
    }catch {/* invalid user record cannot disable built-in search */}
  }
  return out
}
export function platforms(){
  return [...PLATFORMS]
}
export function searchKnowledge(query='',platform='all'){
  if(typeof query!=='string'||query.length>200||typeof platform!=='string'||!PLATFORMS.has(platform))
    throw Error('invalid knowledge search')
  const tokens=query.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,12)
  return [...builtin(),...userNotes()].flatMap(row=>{
    if(platform!=='all'&&!row.platforms.includes(platform))return []
    const title=row.title.toLowerCase(),summary=row.summary.toLowerCase()
    const signal=row.signals.join(' ').toLowerCase()
    const rest=[row.route,...row.platforms,...row.checks,...row.alternatives,row.verification].join(' ').toLowerCase()
    if(tokens.length && !tokens.every(t=>(title+summary+signal+rest).includes(t)))return []
    const score=tokens.reduce((n,t)=>n+(title.includes(t)?5:0)+(signal.includes(t)?3:0)+(summary.includes(t)?2:0)+(rest.includes(t)?1:0),0)
    return [{id:row.id,title:row.title,summary:row.summary,platforms:row.platforms,
      route:row.route,origin:row.origin,confidence:row.confidence,
      case_id:row.case_id,score}]
  }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,30)
}
export function knowledgeEntry(id){
  if(typeof id!=='string'||!ID.test(id))throw Error('invalid knowledge identifier')
  const found=[...builtin(),...userNotes()].find(e=>e.id===id)
  if(!found)throw Error('knowledge entry not found')
  return found
}
