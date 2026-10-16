/**
 * Reverse-only bundled Skill installer. Stages and installs each complete Skill
 * directory atomically; never overwrites user-owned directories or files.
 * Source resources are data, never executed during install.
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync,
  unlinkSync, rmdirSync, mkdtempSync, rmSync, renameSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const ROOT=fileURLToPath(new URL('.',import.meta.url))
const MAX_FILES=128
const MAX_SKILL_BYTES=1024*1024
const MAX_DEPTH=8
export const name='dsh-reverse-skill-bootstrap'
export const inject=[]
export const SKILLS=[
  'universal-reverse-core',
  'binary-triage',
  'ghidra-headless',
  'gdb-native-debugging',
  'frida-runtime-instrumentation',
  'javascript-deobfuscation',
  'network-protocol-reconstruction',
  'firmware-static-analysis',
  'electron-javascript-analysis',
  'reverse-evidence-report',
]
// Retire only the original unmodified legacy single-file Android Skill.
export const RETIRED_ANDROID_BLOB='4af068e110d9cf375a242f77d32678fdcae32abd'
function retireOldAndroidSkill(dest){
  const dir=join(dest,'android-apk-analysis')
  try{
    if(!lstatSync(dir).isDirectory() || readdirSync(dir).join(',')!=='SKILL.md')return false
    const p=join(dir,'SKILL.md')
    if(!lstatSync(p).isFile())return false
    const data=readFileSync(p)
    const hash=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')
    if(hash!==RETIRED_ANDROID_BLOB)return false
    unlinkSync(p)
    rmdirSync(dir)
    return true
  }catch(e){if(e?.code==='ENOENT')return false;throw e}
}
function ensureSafeDir(p){
  if(existsSync(p)){
    const stat=lstatSync(p)
    if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Unsafe Skill directory: '+p)
  }else{
    mkdirSync(p,{mode:0o700})
  }
}
function skillAssets(root,id){
  const src=join(root,id)
  if(!lstatSync(src).isDirectory() || lstatSync(src).isSymbolicLink())
    throw Error('Invalid Skill source directory: '+id)
  const assets=[]
  let total=0
  function walk(dir,prefix,depth){
    if(depth>MAX_DEPTH)throw Error('Skill resource nesting exceeds limit: '+id)
    const entries=readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))
    for(const entry of entries){
      if(!entry.name || entry.name==='.' || entry.name==='..' || entry.name.includes('/') || entry.name.includes('\\'))
        throw Error('Invalid Skill resource name: '+id)
      const child=join(dir,entry.name)
      const rel=prefix ? prefix+'/'+entry.name : entry.name
      if(entry.isSymbolicLink())throw Error('Symlink in packaged Skill: '+rel)
      if(entry.isDirectory()){walk(child,rel,depth+1);continue}
      if(!entry.isFile())throw Error('Non-file packaged Skill: '+rel)
      const bytes=readFileSync(child)
      total+=bytes.length
      assets.push({rel,bytes})
      if(assets.length>MAX_FILES || total>MAX_SKILL_BYTES)
        throw Error('Packaged Skill exceeds file or byte budget: '+id)
    }
  }
  walk(src,'',0)
  const main=assets.find(x=>x.rel==='SKILL.md')
  if(!main || !main.bytes.toString('utf8').startsWith('---\nname: '+id+'\n'))
    throw Error('Invalid bundled reverse Skill: '+id)
  return assets
}
export function installSkills(home=process.env.DSH_HOME||join(homedir(),'.dsh'),source=join(ROOT,'skills')){
  const root=join(home,'reverse-engineering')
  const dest=join(root,'skills')
  ensureSafeDir(home)
  ensureSafeDir(root)
  ensureSafeDir(dest)
  retireOldAndroidSkill(dest)
  for(const id of SKILLS){
    const target=join(dest,id)
    // Existing directories belong to the user (including prior bootstrap copies).
    // Never augment/overwrite them without a future explicit migration protocol.
    if(existsSync(target) || safeSymlink(target))continue
    const assets=skillAssets(source,id) // validate all source bytes before staging anything
    const stage=mkdtempSync(join(dest,'.stage-'+id+'-'))
    try{
      for(const {rel,bytes} of assets){
        const pieces=rel.split('/')
        let next=stage
        for(const piece of pieces.slice(0,-1)){
          next=join(next,piece)
          ensureSafeDir(next)
        }
        writeFileSync(join(stage,...pieces),bytes,{flag:'wx',mode:0o600})
      }
      if(!(existsSync(target)||safeSymlink(target)))renameSync(stage,target)
    }finally{
      if(existsSync(stage))rmSync(stage,{recursive:true,force:true})
    }
  }
  return {home,dest,skills:SKILLS}
}
function safeSymlink(p){try{return lstatSync(p).isSymbolicLink()}catch{return false}}
export function apply(ctx){
  try{
    const value=installSkills()
    ctx.logger?.info?.('Reverse Edition skills ready: %d',value.skills.length)
  }catch(e){ctx.logger?.error?.('Reverse Edition skill bootstrap failed: %s',e?.message||String(e));throw e}
}
export default {name,inject,apply}
