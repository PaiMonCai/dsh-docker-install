import { readFileSync } from 'node:fs'

// Build metadata does not affect SemVer precedence; prerelease length does.
function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) throw new Error('Invalid SemVer version: ' + version)
  return { core: match.slice(1, 4).map(Number), pre: match[4] === undefined ? null : match[4].split('.') }
}

function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return Math.sign(x.core[i] - y.core[i])
  }
  if (x.pre === null) return y.pre === null ? 0 : 1
  if (y.pre === null) return -1
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const a = x.pre[i], b = y.pre[i]
    if (a === b) continue
    const aNum = /^(0|[1-9]\d*)$/.test(a), bNum = /^(0|[1-9]\d*)$/.test(b)
    if (aNum && bNum) return BigInt(a) < BigInt(b) ? -1 : 1
    if (aNum !== bNum) return aNum ? -1 : 1
    return a < b ? -1 : 1
  }
  return Math.sign(x.pre.length - y.pre.length)
}

function detectUpdate(meta, current) {
  parseVersion(current)
  if (!meta?.versions || typeof meta.versions !== 'object') throw new Error('npm registry metadata is missing versions')
  const versions = Object.keys(meta.versions).filter(v => {
    try { parseVersion(v); return true } catch { return false }
  })
  if (!versions.length) throw new Error('npm registry returned no valid SemVer versions')
  versions.sort(compareVersions)
  const latest = versions[versions.length - 1]
  const channels = Object.entries(meta['dist-tags'] || {})
    .filter(([, version]) => version === latest).map(([name]) => name)
  return { latest, updated: compareVersions(latest, current) > 0, channels }
}

export { compareVersions, detectUpdate }

if (process.argv[1]?.endsWith('semver-max.mjs')) {
  try {
    const meta = JSON.parse(readFileSync(0, 'utf8'))
    const result = detectUpdate(meta, process.argv[2] || '')
    console.log(result.latest + ' ' + result.updated)
    console.log(result.channels.join(','))
  } catch (error) {
    console.error('Version check failed: ' + error.message)
    process.exitCode = 1
  }
}
