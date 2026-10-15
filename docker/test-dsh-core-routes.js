#!/usr/bin/env node
'use strict'
// Checks upstream core API's route/auth fence, not merely whether '/' serves HTML.
// Run inside a started container. Never logs tokens, cookie headers or response bodies.
const http=require('node:http')
const {resolveBindHost}=require('./resolve-bind-host.js')
const host=resolveBindHost(process.env.DSH_BIND_HOST||'')
const port=Number(process.env.DSH_PORT||3080)
const endpoints=['session/create','directoryPicker/list','workspaceFiles/list']
async function probe(endpoint) {
  const body=JSON.stringify({type:'client-request',rpcId:'dsh-core-route-smoke',
    method:endpoint,payload:{args:{}}})
  return await new Promise((resolve,reject)=>{
    const req=http.request({host,port,method:'POST',path:'/api/'+endpoint,
      headers:{Host:'127.0.0.1:'+port,'content-type':'application/json',
        'content-length':Buffer.byteLength(body)},timeout:5000},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode))
    })
    req.on('timeout',()=>req.destroy(Error('timeout')))
    req.on('error',reject)
    req.end(body)
  })
}
;(async()=>{
  let failed=false
  for(const path of endpoints) {
    const code=await probe(path)
    console.log('DSH core route '+path+': HTTP '+code)
    if(code!==401)failed=true
  }
  if(failed) {
    console.error('Core API route/auth gate mismatch: expected unauthenticated HTTP 401. HTTP 404 suggests missing backend or proxy routing; 405 suggests SPA fallback.')
    process.exitCode=1
  }
})().catch(e=>{console.error('Core API route smoke: '+e.message);process.exitCode=1})
