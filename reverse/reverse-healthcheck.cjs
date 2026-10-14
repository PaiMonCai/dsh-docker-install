'use strict'
// Docker HEALTHCHECK for Reverse only: Web reachable AND sessionController alive.
const fs = require('node:fs')
const { probeWeb, HEALTHY_STATUS_CODES } = require('/usr/local/bin/dsh-healthcheck.js')
async function main() {
  try {
    const code = await probeWeb()
    if (!HEALTHY_STATUS_CODES.has(code)) throw Error('web HTTP ' + code)
    const data = JSON.parse(fs.readFileSync('/tmp/dsh-reverse-session-ready.json', 'utf8'))
    if (!Number.isSafeInteger(data.pid) || data.pid < 2 ||
        !Number.isSafeInteger(data.started)) throw Error('invalid session marker')
    process.kill(data.pid, 0)
  } catch (error) {
    console.error('reverse-healthcheck: ' + error.message)
    process.exitCode = 1
  }
}
if (require.main === module) void main()
module.exports = { main }
