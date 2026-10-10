'use strict'

const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { join } = require('node:path')
const { probeWeb, HEALTHY_STATUS_CODES } = require('../docker/dsh-healthcheck.js')

const execFileAsync = promisify(execFile)
const script = join(__dirname, '..', 'docker', 'dsh-healthcheck.js')

async function run() {
  let responseCode = 200
  const seenHosts = []
  const server = createServer((request, response) => {
    seenHosts.push(request.headers.host)
    response.writeHead(responseCode)
    response.end('probe')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const env = { ...process.env, DSH_BIND_HOST: '127.0.0.1', DSH_PORT: String(port) }

  try {
    for (const code of [200, 302, 401, 403, 503]) {
      responseCode = code
      assert.equal(await probeWeb({ bindHost: '127.0.0.1', port }), code)
      if (HEALTHY_STATUS_CODES.has(code)) {
        await execFileAsync(process.execPath, [script], { env })
      } else {
        await assert.rejects(execFileAsync(process.execPath, [script], { env }),
          (error) => error.code === 1 && error.stderr.includes(`HTTP ${code}`))
      }
    }

    assert.ok(seenHosts.length >= 10)
    assert.ok(seenHosts.every((host) => host === `127.0.0.1:${port}`))
    await assert.rejects(probeWeb({ bindHost: '127.0.0.1', port: 'bad' }),
      /invalid DSH_PORT/)
    await assert.rejects(probeWeb({ bindHost: '0.0.0.0', port }),
      /DSH_BIND_HOST/)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  await assert.rejects(probeWeb({ bindHost: '127.0.0.1', port }),
    /ECONNREFUSED|ECONNRESET/)
  console.log('[✓] DSH Docker healthcheck tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
