/**
 * One-provider native compaction takeover. Deliberately restricted to an
 * explicit single-owner LAB boot: no live plugin re-registration, no second
 * ctx.compaction service, and no speculative preset-wide edits.
 */
import { readSettings } from './storage.mjs'
import { resolvePolicy } from './policy.mjs'
export const BASIC='@deepseek-ai/dsh-compaction-basic'
export const MANUAL='@deepseek-ai/dsh-command-compact'
export const TIERED='/opt/dsh/plugins/dsh-context-manager/tiered-native.js'
export const GATE='dshContextTieredPolicy'
const PRESET_PACKAGE='@deepseek-ai/dsh-agent-preset'
const BILI=new Set(['billion-context','bili-native'])
const ALLOWED_PRESET='standard'
function safeRows(rows,depth=0) {
  if(depth>20||!Array.isArray(rows)||rows.length>2048)
    throw Error('unverifiable preset plugin tree')
  return rows
}
function checkAndReplace(rows,policy,observed,depth=0) {
  return safeRows(rows,depth).map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))
      throw Error('unverifiable preset row')
    const {name,disabled}=row
    if(name===BASIC&&!disabled) {
      observed.basic++
      return {...row,name:TIERED,
        config:{...(row.config&&typeof row.config==='object'&&!Array.isArray(row.config)?row.config:{}),
          ...policy.basic,
          modelPolicies: policy.modelPolicies??[]}}
    }
    if(name===MANUAL&&!disabled)observed.manual++
    if(BILI.has(name)&&!disabled)observed.external++
    if(name===TIERED&&!disabled)observed.tiered++
    if(Array.isArray(row.config)&&row.group===true)
      return {...row,config:checkAndReplace(row.config,policy,observed,depth+1)}
    if(row.config&&typeof row.config==='object'&&Array.isArray(row.config.plugins))
      return {...row,config:{...row.config,
        plugins:checkAndReplace(row.config.plugins,policy,observed,depth+1)}}
    return row
  })
}
/** A precise one-for-one transformation, never a second inserted backend. */
export function replacePresetCompactor(preset,settings,target=ALLOWED_PRESET) {
  if(!preset||preset.id!==target||target!==ALLOWED_PRESET)
    return {changed:false,config:preset,reason:'preset-not-selected'}
  if(!Array.isArray(preset.plugins)) throw Error('missing preset plugin tree')
  const desired=resolvePolicy(settings,{agentId:target})
  if(desired.engine!=='tiered')throw Error('selected preset policy is not tiered')
  // Per-model mode switches would conflict with the single bound service;
  // reject unsupported partial mode override instead of lying in the UI.
  for(const row of settings.modelPolicies) {
    if(row.engine&&row.engine!=='inherit'&&row.engine!=='tiered')
      throw Error('model engine override unsupported in tiered pilot')
  }
  const modelPolicies=settings.modelPolicies.map(row=>({
    provider:row.provider,model:row.model,...(row.basic??{}),
  }))
  const seen={basic:0,manual:0,external:0,tiered:0}
  const plugins=checkAndReplace(preset.plugins,{basic:desired.basic,modelPolicies},seen)
  if(seen.external||seen.tiered||seen.basic!==1||seen.manual!==1)
    throw Error('single-owner native compaction precondition failed')
  return {changed:true,config:{...preset,plugins},
    evidence:{preset:target,replaced:1,manual:1,external:0}}
}
export function createTakeoverPolicy(env=process.env,settings) {
  const active=env.DSH_CONTEXT_MANAGER_TIERED_ACTIVE==='1'
  if(!active)return {active:false,reason:'disabled'}
  if(env.DSH_CONTEXT_MANAGER_TIERED_OWNER_TESTED!=='1'
    ||env.DSH_CONTEXT_MANAGER_NO_EXTERNAL_PROXY!=='1')
    throw Error('tiered pilot requires owner and external-proxy attestations')
  const saved=settings??readSettings()
  if(saved.engine!=='tiered')throw Error('tiered pilot requires saved tiered policy')
  return {active:true,settings:saved,target:ALLOWED_PRESET,phase:'single-preset-lab-only'}
}
export function isPresetEntry(entry) {
  return entry?.options?.name===PRESET_PACKAGE
}
