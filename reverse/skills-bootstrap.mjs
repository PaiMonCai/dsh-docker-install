/**
 * Reverse Edition only: install vetted static SKILL.md assets into the
 * existing reverse-engineering preset skill search path on boot.
 * Never overwrite user-edited skills or touch the Standard DSH_HOME.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
const ROOT=fileURLToPath(new URL('.',import.meta.url))
export const name='dsh-reverse-skill-bootstrap'
export const inject=[]
export const SKILLS=[
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
// Exact Git blob ID of the previously bundled Android Skill. Retire only the
// unmodified single-file directory; never remove a user's edited copy.
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
export function installSkills(home=process.env.DSH_HOME||join(homedir(),'.dsh'),source=join(ROOT,'skills')){
  const dest=join(home,'reverse-engineering','skills')
  retireOldAndroidSkill(dest)
  for(const id of SKILLS){
    const origin=join(source,id,'SKILL.md')
    const body=readFileSync(origin,'utf8')
    if(!body.startsWith('---\nname: '+id+'\n'))throw Error('Invalid bundled reverse skill: '+id)
    const target=join(dest,id)
    if(existsSync(target)||safeSymlink(target))continue
    mkdirSync(target,{recursive:true,mode:0o700})
    writeFileSync(join(target,'SKILL.md'),body,{flag:'wx',mode:0o600})
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
