#!/usr/bin/env node
'use strict'
/**
 * Patch ONLY the installed billion-context DSH browser client to use the
 * authenticated same-origin /__bili/ route, without changing the Agent's
 * origin or model traffic. Guarded and reversible across package upgrades.
 */
const fs = require('node:fs')
const path = require('node:path')
const PACKAGE = 'billion-context'
const CLIENT = path.join('dist','agent','dsh-native-client.js')
const BACKUP = '.dsh-original-before-domain-bridge'
const MARKER = 'DSH_BILI_SAME_ORIGIN_UI'
const TICK = String.fromCharCode(96)

function replacement(code, pattern, value, label) {
  const hits = [...code.matchAll(new RegExp(pattern.source, 'g'))]
  if (hits.length !== 1) throw Error(label + ': unsupported UI bundle layout (' + hits.length + ')')
  return code.replace(pattern, value)
}
function transform(code) {
  if (code.includes(MARKER)) return {status:'already-patched',code}
  if (!code.includes('window.__ModuleLoader__') || !code.includes('billion-context'))
    throw Error('not the billion-context native DSH client')
  let out = code
  const name = '[A-Za-z_$][\\w$]*'
  // Some releases (including 0.1.197) have no embed preflight. If present,
  // still require its known layout so we never leave a loopback probe behind.
  if (out.includes('EMBED_PROBE_PATH')) {
    out = replacement(out, new RegExp('fetch\\(\\s*'+TICK+'\\$\\{'+name+'\\}\\$\\{EMBED_PROBE_PATH\\}'+TICK+'\\s*\\)'),
      'fetch("/__bili/?embed=1")','embed preflight')
  }
  out = replacement(out, new RegExp('src:\\s*'+TICK+'\\$\\{'+name+'\\}/__bili/\\?embed=1'),
    'src: '+TICK+'/__bili/?embed=1','settings iframe')
  out = replacement(out, new RegExp('openExternal\\(\\s*'+TICK+'\\$\\{'+name+'\\}/__bili/'+TICK+'\\s*\\)'),
    'openExternal("/__bili/")','external UI button')
  return {status:'patched',code:out+'\n/* '+MARKER+' */\n'}
}
function packageClient(home) {
  const mount=path.join(home,'profiles','web','node_modules',PACKAGE)
  if (!fs.existsSync(mount)) return null
  const resolved=fs.realpathSync(mount),root=fs.realpathSync(home)
  if (!resolved.startsWith(root+path.sep)) throw Error('package symlink leaves DSH_HOME')
  const info=JSON.parse(fs.readFileSync(path.join(resolved,'package.json'),'utf8'))
  if (info.name!==PACKAGE || typeof info.version!=='string') throw Error('unexpected third-party package')
  const file=path.join(resolved,CLIENT),st=fs.lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.size>2*1024*1024) throw Error('unsafe client bundle')
  return {file,version:info.version}
}
function writeAtomic(file,text) {
  const st=fs.statSync(file)
  const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.dsh-'+process.pid)
  try {
    fs.writeFileSync(temp,text,{mode:st.mode&0o777,flag:'wx'})
    fs.renameSync(temp,file)
  } finally { try{fs.unlinkSync(temp)}catch(e){if(e.code!=='ENOENT')throw e} }
}
function apply(home,enabled=true) {
  const found=packageClient(home)
  if (!found) return {status:'not-installed'}
  const {file,version}=found,backup=file+BACKUP
  const current=fs.readFileSync(file,'utf8')
  if (!enabled) {
    if (!current.includes(MARKER)) return {status:'disabled',version}
    if (!fs.existsSync(backup)) throw Error('original client backup missing')
    const original=fs.readFileSync(backup,'utf8')
    if (transform(original).status!=='patched') throw Error('invalid original client backup')
    writeAtomic(file,original)
    return {status:'restored',version}
  }
  if (current.includes(MARKER)) return {status:'already-patched',version}
  const result=transform(current)
  if (fs.existsSync(backup) && fs.readFileSync(backup,'utf8')!==current)
    fs.unlinkSync(backup)
  if (!fs.existsSync(backup)) fs.writeFileSync(backup,current,{flag:'wx',mode:0o600})
  writeAtomic(file,result.code)
  return {status:result.status,version}
}
if (require.main===module) {
  try {
    const value=String(process.env.DSH_BILI_UI_BRIDGE??'true').toLowerCase()
    if (!['true','false','1','0','yes','no'].includes(value)) throw Error('invalid DSH_BILI_UI_BRIDGE')
    const result=apply(process.env.DSH_HOME||'/root/.dsh',!['false','0','no'].includes(value))
    process.stderr.write('DSH billion-context domain UI: '+result.status+
      (result.version?' (billion-context '+result.version+')':'')+'\n')
  } catch(error) {
    process.stderr.write('WARNING: billion-context UI bridge inactive: '+String(error.message)+'\n')
    process.exitCode=2
  }
}
module.exports={transform,apply,packageClient,MARKER}
