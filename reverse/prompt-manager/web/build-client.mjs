#!/usr/bin/env node
/**
 * Small deterministic source assembler for the native DSH browser plugin.
 * The runtime still loads only client.js; no extra fetches, loaders or dependencies.
 * Parts are intentionally concatenated byte-for-byte, preserving hook order
 * and DSH's existing window.__ModuleLoader__ registration contract.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PARTS = [
  "00-bootstrap.part",
  "10-ui-primitives.js",
  "20-prompt-settings.js",
  "30-case-graph.js",
  "40-workbench.js",
  "90-registration.part"
]
const dir=dirname(fileURLToPath(import.meta.url))
export function assemble() {
  return PARTS.map(file=>readFileSync(join(dir,'src',file),'utf8')).join('')
}
export function check() {
  const existing=readFileSync(join(dir,'client.js'),'utf8')
  if(existing!==assemble())throw Error('client.js is out of sync: run node reverse/prompt-manager/web/build-client.mjs')
  return true
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='--check'){
    try{check();console.log('Native Reverse Web bundle matches modular source')}
    catch(error){console.error(error.message);process.exitCode=1}
  }else if(process.argv.length===2){
    const target=join(dir,'client.js'),tmp=target+'.build-'+process.pid
    try {writeFileSync(tmp,assemble());renameSync(tmp,target);console.log('Generated '+target)}
    finally {try{unlinkSync(tmp)}catch{}}
  }else {console.error('Usage: node build-client.mjs [--check]');process.exitCode=2}
}
