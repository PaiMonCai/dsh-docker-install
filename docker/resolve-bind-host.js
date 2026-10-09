'use strict'

const { isIP } = require('node:net')
const { networkInterfaces } = require('node:os')

// DSH 0.2.1-alpha.2 rejects unspecified bind addresses. Publishing a Docker
// port forwards to the container's concrete interface address, not to loopback.
function resolveBindHost(explicitHost = '', interfaces = networkInterfaces()) {
  if (explicitHost !== '') {
    if (isIP(explicitHost) === 0) {
      throw new Error(`DSH_BIND_HOST must be a concrete IP address, got ${JSON.stringify(explicitHost)}`)
    }
    if (/^(?:0\.0\.0\.0|::|::0|::ffff:(?:0\.0\.0\.0|0:0))$/i.test(explicitHost)) {
      throw new Error('DSH_BIND_HOST must not be an unspecified (wildcard) address')
    }
    return explicitHost
  }

  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter(({ address, family, internal }) => family === 'IPv4' && !internal && isIP(address) === 4 && address !== '0.0.0.0')
      .map(({ address }) => ({ name, address })),
  )
  // Docker normally attaches the published port to eth0. A different concrete
  // interface is still supported when an image runs under a custom network.
  candidates.sort((a, b) => (a.name === 'eth0' ? 0 : 1) - (b.name === 'eth0' ? 0 : 1) || a.name.localeCompare(b.name))
  if (candidates.length === 0) {
    throw new Error('Cannot find a non-loopback container IPv4 address; set DSH_BIND_HOST to a concrete local address')
  }
  return candidates[0].address
}

if (require.main === module) {
  try {
    process.stdout.write(`${resolveBindHost(process.env.DSH_BIND_HOST || '')}\n`)
  } catch (error) {
    console.error(`resolve-dsh-bind-host: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { resolveBindHost }
