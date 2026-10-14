/** Optional independent Reverse-only system-prompt/assemble guidance block. */
import { join } from 'node:path'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { atomic, root, LIMIT } from './core.mjs'
export const HOOK_SECTION = 'reverse:user-hook-guidance'
const EMPTY = Object.freeze({ schema:1, enabled:false, text:'' })
function validate(input) {
  if (!input || input.schema !== 1 || typeof input.enabled !== 'boolean' ||
      typeof input.text !== 'string' || Buffer.byteLength(input.text)>LIMIT ||
      /{{[^{}]*}}/.test(input.text) || (input.enabled && !input.text.trim()))
    throw Error('invalid hook guidance configuration')
  return { schema:1,enabled:input.enabled,text:input.text }
}
const file = home => join(root(home),'hook-guidance.json')
export function readHook(home) {
  const path=file(home)
  if (!existsSync(path)) return {...EMPTY}
  const st=lstatSync(path)
  if (!st.isFile() || st.size>LIMIT+300) throw Error('unsafe hook guidance file')
  return validate(JSON.parse(readFileSync(path,'utf8')))
}
export function writeHook(state,home) {
  const checked=validate({schema:1,...state})
  atomic(file(home),JSON.stringify(checked,null,2)+'\n')
  return checked
}
export function applyHook(sections, config) {
  if (!config.enabled) return {changed:false,sections,reason:'disabled'}
  if (!Array.isArray(sections)) return {changed:false,sections,reason:'missing sections'}
  const i=sections.findIndex(x=>x?.name==='deployment:persona-prefix' &&
    typeof x.text==='string' && x.text.startsWith('You are Reverse Engineer'))
  // A preset that replaces Persona may remove its recognizable prefix. In that
  // case anchor to its still-present named slot, provided caller checked Reverse.
  const anchor=i>=0?i:sections.findIndex(x=>x?.name==='deployment:persona-prefix')
  if(anchor<0 || sections.some(x=>x?.name===HOOK_SECTION))
    return {changed:false,sections,reason:'missing anchor or duplicate'}
  const next=sections.slice()
  next.splice(anchor+1,0,{name:HOOK_SECTION,text:config.text,interpolate:false})
  return {changed:true,sections:next}
}
