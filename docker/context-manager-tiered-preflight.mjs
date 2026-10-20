#!/usr/bin/env node
// Fail CLOSED before launching DSH. Never auto-detect away an external proxy.
import {readFileSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {createTakeoverPolicy} from '../docker/plugins/dsh-context-manager/takeover.mjs'
const active=process.env.DSH_CONTEXT_MANAGER_TIERED_ACTIVE==='1'
if(!active) process.exit(0)
try {
  const policy=createTakeoverPolicy()
  if(!policy.active)throw Error('pilot must be active')
  const home=process.env.DSH_HOME||'/root/.dsh'
  for(const dirname of [join(home,'profiles'),join(home,'plugins')]) {
    let children=[]
    try {children=readdirSync(dirname,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name)}
    catch(e){if(e.code!=='ENOENT')throw e}
    for(const child of children) {
      const path=join(dirname,child,'package.json')
      let raw
      try{raw=JSON.parse(readFileSync(path,'utf8'))}
      catch(e){if(e.code==='ENOENT')continue;throw e}
      if(JSON.stringify(raw.dsh?.profile?.bundles??raw.dependencies??{}).includes('billion-context'))
        throw Error('billion-context is present in a DSH profile')
    }
  }
  if((process.env.HTTPS_PROXY||process.env.HTTP_PROXY||'').includes('/bili/'))
    throw Error('external bili traffic routing detected')
  process.stdout.write('DSH_CONTEXT_MANAGER_TIERED_PREFLIGHT_ALLOWED lab=true\n')
}catch(e) {
  process.stderr.write('DSH_CONTEXT_MANAGER_TIERED_PREFLIGHT_DENIED '+String(e.message).slice(0,160)+'\n')
  process.exit(1)
}
