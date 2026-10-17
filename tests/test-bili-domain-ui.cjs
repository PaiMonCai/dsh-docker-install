'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const http=require('node:http')
const {pathToFileURL}=require('node:url')
const {transform,apply,MARKER}=require('../docker/patch-bili-client-ui.js')
const modulePath=pathToFileURL(path.resolve(__dirname,'../docker/plugins/dsh-bili-ui-bridge/index.js')).href
const tick=String.fromCharCode(96),dollar=String.fromCharCode(36)
const clientSource=[
  'window.__ModuleLoader__.load({id:"billion-context",factory:function(require){',
  'function probeEmbedRoute(origin){ fetch('+tick+dollar+'{origin}'+dollar+'{EMBED_PROBE_PATH}'+tick+') }',
  'return {src: '+tick+dollar+'{origin}/__bili/?embed=1&lang='+dollar+'{lang}#/'+dollar+'{page}'+tick+',',
  'onClick:()=>openExternal('+tick+dollar+'{origin}/__bili/'+tick+')};',
  '}});'
].join('\n')
test('registers a segment prefix without a trailing slash for DSH child routes',async()=>{
 const {apply:register,PREFIX}=await import(modulePath)
 let route,dispose
 register({
   effect:fn=>{dispose=fn()},
   webServer:{register:value=>{route=value;return ()=>{route=undefined}}},
   connection:{}
 })
 assert.equal(PREFIX,'/__bili')
 assert.equal(route.kind,'prefix')
 assert.equal(route.path,PREFIX)
 dispose()
 assert.equal(route,undefined)
})
test('client patch touches only browser UI, preserves model address and is reversible',()=>{
 const patched=transform(clientSource)
 assert.equal(patched.status,'patched')
 assert.ok(patched.code.includes(MARKER))
 assert.ok(patched.code.includes('fetch("/__bili/?embed=1")'))
 assert.ok(patched.code.includes('src: '+tick+'/__bili/?embed=1'))
 assert.ok(patched.code.includes('openExternal("/__bili/")'))
 assert.equal(transform(patched.code).status,'already-patched')
 assert.throws(()=>transform('unrecognized compiled code'),/not the billion/)
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-bili-domain-'))
 try{
   const dir=path.join(home,'profiles','web','node_modules','billion-context','dist','agent')
   fs.mkdirSync(dir,{recursive:true})
   fs.writeFileSync(path.join(dir,'../../package.json'),JSON.stringify({name:'billion-context',version:'0.1.197'}))
   const file=path.join(dir,'dsh-native-client.js')
   fs.writeFileSync(file,clientSource)
   assert.equal(apply(home,true).status,'patched')
   assert.equal(apply(home,true).status,'already-patched')
   assert.equal(apply(home,false).status,'restored')
   assert.equal(fs.readFileSync(file,'utf8'),clientSource)
   assert.equal(apply(home,false).status,'disabled')
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})
test('clients without embed preflight still receive same-origin iframe and external UI',()=>{
 const source=clientSource.split('\n').filter(line=>!line.includes('probeEmbedRoute')).join('\n')
 const patched=transform(source)
 assert.equal(patched.status,'patched')
 assert.ok(patched.code.includes('src: '+tick+'/__bili/?embed=1&lang='))
 assert.ok(patched.code.includes('openExternal("/__bili/")'))
 assert.equal(transform(patched.code).status,'already-patched')
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-bili-no-probe-'))
 try{
   const dir=path.join(home,'profiles','web','node_modules','billion-context','dist','agent')
   fs.mkdirSync(dir,{recursive:true})
   fs.writeFileSync(path.join(dir,'../../package.json'),JSON.stringify({name:'billion-context',version:'0.1.197'}))
   const file=path.join(dir,'dsh-native-client.js')
   fs.writeFileSync(file,source)
   assert.equal(apply(home,true).status,'patched')
   assert.equal(apply(home,false).status,'restored')
   assert.equal(fs.readFileSync(file,'utf8'),source)
 }finally{fs.rmSync(home,{recursive:true,force:true})}
})
test('changed preflight or missing iframe fails closed',()=>{
 for(const changed of [
   clientSource.replace('fetch('+tick,'fetchOther('+tick),
   clientSource.replace('src: '+tick,'unknown: '+tick),
 ]){
   assert.throws(()=>transform(changed),/unsupported UI bundle layout/)
 }
})
async function listen(handler){
 const server=http.createServer(handler)
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve))
 return {server,origin:'http://127.0.0.1:'+server.address().port,
   close:()=>new Promise(r=>server.close(r))}
}
const connect=async(url,options={})=>{
 const r=await fetch(url,options)
 return {status:r.status,headers:r.headers,text:await r.text()}
}
test('authenticated same-origin bridge proxies UI but not cookies or privileged plugin routes',async()=>{
 const {validAdminPath,parseProxyOrigin,handleBiliUi}=await import(modulePath)
 assert.equal(validAdminPath('/__bili/'),true)
 assert.equal(validAdminPath('/__bili/config'),true)
 assert.equal(validAdminPath('/__bili/plugin/tool'),false)
 assert.equal(validAdminPath('/__bili/watcher'),false)
 assert.equal(validAdminPath('/__bili/../../../etc/passwd'),false)
 assert.throws(()=>parseProxyOrigin('http://example.com:18787'))
 assert.throws(()=>parseProxyOrigin('http://169.254.169.254:80'))
 assert.throws(()=>parseProxyOrigin('https://127.0.0.1:18787'))
 assert.equal(parseProxyOrigin('http://127.0.0.1:18787'),'http://127.0.0.1:18787')
 let hits=0,upHeaders
 const bili=await listen((req,res)=>{
   hits++;upHeaders=req.headers
   if(req.url.startsWith('/__bili/?')){
     res.writeHead(200,{'content-type':'text/html; charset=utf-8'})
     res.end('<h1>Local bili UI</h1>');return
   }
   if(req.url==='/__bili/config'){
     res.writeHead(200,{'content-type':'application/json'})
     res.end(JSON.stringify({method:req.method}));return
   }
   res.writeHead(404);res.end()
 })
 const auth={admit:req=>req.headers.cookie==='dsh-session=valid'
   ?{peer:{principal:{kind:'owner'}}}:{rejection:401}}
 const dsh=await listen((req,res)=>handleBiliUi(req,res,auth,async()=>bili.origin))
 try{
   const unauth=await connect(dsh.origin+'/__bili/?embed=1')
   assert.equal(unauth.status,401);assert.equal(hits,0)
   const blocked=await connect(dsh.origin+'/__bili/plugin/tool',{headers:{cookie:'dsh-session=valid'}})
   assert.equal(blocked.status,404);assert.equal(hits,0)
   const html=await connect(dsh.origin+'/__bili/?embed=1',{headers:{cookie:'dsh-session=valid'}})
   assert.equal(html.status,200);assert.match(html.text,/Local bili UI/)
   assert.equal(html.headers.get('x-frame-options'),'SAMEORIGIN')
   assert.equal(html.headers.get('cache-control'),'no-store')
   assert.equal(upHeaders.cookie,undefined)
   const failPut=await connect(dsh.origin+'/__bili/config',{
     method:'PUT',headers:{cookie:'dsh-session=valid','content-type':'application/json'},
     body:'{"enabled":true}'})
   assert.equal(failPut.status,403)
   const realPut=await connect(dsh.origin+'/__bili/config',{
     method:'PUT',headers:{cookie:'dsh-session=valid','content-type':'application/json',
       origin:dsh.origin,'x-proxy-secret':'should-not-forward'},
     body:'{"enabled":true}'})
   assert.equal(realPut.status,200);assert.match(realPut.text,/"PUT"/)
   assert.equal(upHeaders.origin,bili.origin)
   assert.equal(upHeaders.cookie,undefined)
   assert.equal(upHeaders['x-proxy-secret'],undefined)
 }finally{await dsh.close();await bili.close()}
})
test('live /bili/origin follows changed local backend; remote origins fail closed',async()=>{
 const {resolveBiliOrigin}=await import(modulePath)
 let origin='http://127.0.0.1:18787'
 const dsh=await listen((req,res)=>{
   if(req.url!=='/bili/origin'){res.writeHead(404);res.end();return}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({origin}))
 })
 const env={DSH_BIND_HOST:'127.0.0.1',DSH_PORT:String(new URL(dsh.origin).port)}
 try{
   assert.equal(await resolveBiliOrigin(env),origin)
   origin='http://127.0.0.1:18788'
   assert.equal(await resolveBiliOrigin(env),origin)
   origin='https://example.com'
   await assert.rejects(resolveBiliOrigin(env))
 }finally{await dsh.close()}
})
