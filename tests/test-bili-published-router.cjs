'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function listen(handler) {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => res.destroy(error))
  })
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  return { origin: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise(resolve => server.close(resolve)) }
}

test('published DSH router dispatches the registered bili iframe and its data requests', async () => {
  const root = process.env.DSH_WEBSERVER_PACKAGE_ROOT
  assert.ok(root, 'set DSH_WEBSERVER_PACKAGE_ROOT to the installed @deepseek-ai/dsh-host-webserver package')
  const { WebServer } = await import(pathToFileURL(path.join(root, 'lib/index.js')))
  const { apply } = await import(pathToFileURL(path.resolve(__dirname, '../docker/plugins/dsh-bili-ui-bridge/index.js')))
  // Use the published register/match implementations, without starting Cordis services.
  const router = Object.assign(Object.create(WebServer.prototype), { exact: new Map(), prefixes: new Map() })
  const auth = { admit: req => req.headers.cookie === 'dsh-session=valid'
    ? { peer: { principal: { kind: 'owner' } } } : { rejection: 401 } }
  const hits = []
  const bili = await listen((req, res) => {
    hits.push({ url: req.url, cookie: req.headers.cookie })
    if (req.url === '/__bili/?embed=1&lang=zh') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<h1>bili UI</h1>')
    } else if (['/__bili/overview', '/__bili/sessions?page=1', '/__bili/config', '/__bili/logs?q=error'].includes(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ path: req.url }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  let dispose, dsh
  const oldHost = process.env.DSH_BIND_HOST, oldPort = process.env.DSH_PORT
  try {
    apply({ connection: auth, webServer: router, effect: fn => { dispose = fn() } })
    dsh = await listen((req, res) => {
      if (req.url === '/bili/origin') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ origin: bili.origin }))
        return
      }
      const route = router.match(new URL(req.url, 'http://dsh.internal').pathname)
      if (route) return route.handler(req, res)
      res.writeHead(404)
      res.end('DSH fallback')
    })
    process.env.DSH_BIND_HOST = '127.0.0.1'
    process.env.DSH_PORT = new URL(dsh.origin).port
    const paths = ['/__bili/?embed=1&lang=zh', '/__bili/overview',
      '/__bili/sessions?page=1', '/__bili/config', '/__bili/logs?q=error']
    for (const url of paths) {
      const denied = await fetch(dsh.origin + url)
      assert.equal(denied.status, 401, 'must reach DSH authentication: ' + url)
      await denied.arrayBuffer()
    }
    assert.equal(hits.length, 0)
    for (const url of paths) {
      const response = await fetch(dsh.origin + url, { headers: { cookie: 'dsh-session=valid' } })
      assert.equal(response.status, 200, 'must reach the bili backend: ' + url)
      if (url.includes('?embed=')) assert.match(await response.text(), /bili UI/)
      else assert.equal((await response.json()).path, url)
    }
    assert.deepEqual(hits.map(hit => hit.url), paths)
    assert.ok(hits.every(hit => hit.cookie === undefined))
    for (const url of ['/__bili/plugin/tool', '/__bili/watcher']) {
      const response = await fetch(dsh.origin + url, { headers: { cookie: 'dsh-session=valid' } })
      assert.equal(response.status, 404)
      assert.equal((await response.json()).error, 'route-not-available')
    }
    assert.equal(hits.length, paths.length)
    assert.equal(router.match('/__billion/overview'), undefined)
    dispose()
    assert.equal(router.match('/__bili/overview'), undefined)
  } finally {
    if (oldHost === undefined) delete process.env.DSH_BIND_HOST
    else process.env.DSH_BIND_HOST = oldHost
    if (oldPort === undefined) delete process.env.DSH_PORT
    else process.env.DSH_PORT = oldPort
    if (dsh) await dsh.close()
    await bili.close()
  }
})
