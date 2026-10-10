'use strict'

// Connect to the exact address chosen by the DSH entrypoint. The upstream DSH
// web server no longer listens on all interfaces (or necessarily loopback).
// Use a loopback Host header for its built-in trusted-host guard; this probe
// originates inside the container and never exposes the endpoint externally.
const http = require('node:http')
const { resolveBindHost } = require('./resolve-bind-host.js')

const HEALTHY_STATUS_CODES = new Set([200, 302, 401])

function probeWeb({
  bindHost = process.env.DSH_BIND_HOST || '',
  port = process.env.DSH_PORT || '3080',
  timeoutMs = 4000,
} = {}) {
  const numericPort = Number(port)
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return Promise.reject(new Error(`invalid DSH_PORT: ${port}`))
  }

  let host
  try {
    host = resolveBindHost(bindHost)
  } catch (error) {
    return Promise.reject(error)
  }

  // Node's native HTTP client does not inherit HTTP_PROXY / HTTPS_PROXY.
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: host,
      port: numericPort,
      path: '/',
      headers: { Host: `127.0.0.1:${numericPort}` },
      agent: false,
      timeout: timeoutMs,
    }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('timeout', () => request.destroy(new Error('probe timed out')))
    request.on('error', reject)
  })
}

async function main() {
  try {
    const statusCode = await probeWeb()
    if (!HEALTHY_STATUS_CODES.has(statusCode)) {
      console.error(`dsh-healthcheck: unexpected HTTP ${statusCode} from DSH web`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`dsh-healthcheck: ${error.message}`)
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = { probeWeb, HEALTHY_STATUS_CODES }
