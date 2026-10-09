'use strict'

const { isIP } = require('node:net')
const { networkInterfaces } = require('node:os')

// Expand valid IPv6 literals to eight words. Embedded dotted IPv4 tails are
// translated into two words so all spellings of wildcard/mapped-zero match.
function ipv6Words(address) {
  let value = address.toLowerCase().split('%')[0]
  if (value.includes('.')) {
    const split = value.lastIndexOf(':')
    const octets = value.slice(split + 1).split('.').map(Number)
    value = value.slice(0, split + 1)
      + ((octets[0] << 8) | octets[1]).toString(16) + ':'
      + ((octets[2] << 8) | octets[3]).toString(16)
  }
  const halves = value.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? Array(8 - left.length - right.length).fill('0') : []
  return [...left, ...fill, ...right].map((word) => Number.parseInt(word, 16))
}

function isWildcardHost(address) {
  const kind = isIP(address)
  if (kind === 4) return address === '0.0.0.0'
  if (kind !== 6) return false
  const words = ipv6Words(address)
  const unspecified = words.every((word) => word === 0)
  const mappedUnspecified = words.slice(0, 5).every((word) => word === 0)
    && words[5] === 0xffff && words[6] === 0 && words[7] === 0
  return unspecified || mappedUnspecified
}

// Docker publishes ports to the container's concrete interface IP, never its
// loopback. Upstream DSH intentionally rejects 0.0.0.0 / :: / mapped-any.
function resolveBindHost(explicitHost = '', interfaces = networkInterfaces()) {
  if (explicitHost !== '') {
    if (isIP(explicitHost) === 0 || isWildcardHost(explicitHost)) {
      throw new Error(`DSH_BIND_HOST must be a concrete IPv4/IPv6 address, got ${JSON.stringify(explicitHost)}`)
    }
    return explicitHost
  }

  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter(({ address, family, internal }) =>
        !internal && (family === 'IPv4' || family === 'IPv6')
        && isIP(address) !== 0 && !isWildcardHost(address)
        && !address.toLowerCase().startsWith('fe80:'))
      .map(({ address, family }) => ({ name, address, family })),
  )
  candidates.sort((a, b) =>
    (a.family === 'IPv4' ? 0 : 1) - (b.family === 'IPv4' ? 0 : 1)
    || (a.name === 'eth0' ? 0 : 1) - (b.name === 'eth0' ? 0 : 1)
    || a.name.localeCompare(b.name))
  // --network none and isolated test containers remain usable locally.
  // Their loopback bind is safe and needs no published Docker port.
  return candidates[0]?.address ?? '127.0.0.1'
}

if (require.main === module) {
  try {
    process.stdout.write(`${resolveBindHost(process.env.DSH_BIND_HOST || '')}\n`)
  } catch (error) {
    console.error(`resolve-dsh-bind-host: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { resolveBindHost, isWildcardHost }
