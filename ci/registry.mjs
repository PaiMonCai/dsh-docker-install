import { createHash } from 'node:crypto'

const accept = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')
const digestPattern = /^sha256:[a-f0-9]{64}$/
export const label = {
  version: 'io.caicailo.dsh.version',
  edition: 'io.caicailo.dsh.edition',
  standardSource: 'io.caicailo.dsh.standard.revision',
  tree: 'io.caicailo.dsh.source.tree',
  base: 'io.caicailo.dsh.base.digest',
  channels: 'io.caicailo.dsh.channels',
  track: 'io.caicailo.dsh.release.track',
  releaseTag: 'io.caicailo.dsh.release.tag',
}

export class ContractError extends Error {}

// Only read the configured repository. An input cannot redirect credentials or
// substitute a similarly tagged image from a different publisher.
export function imageReference(image, reference) {
  if (!/^ghcr\.io\/[a-z0-9._-]+\/[a-z0-9._/-]+$/.test(image)) {
    throw new ContractError('Expected a lowercase GHCR repository')
  }
  if (!reference.startsWith(image + ':') && !reference.startsWith(image + '@')) {
    throw new ContractError('Base image must belong to ' + image)
  }
  const suffix = reference.slice(image.length)
  if (suffix.startsWith('@') ? !digestPattern.test(suffix.slice(1))
    : !/^:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(suffix)) {
    throw new ContractError('Invalid image reference: ' + reference)
  }
  return suffix.slice(1)
}

export function validateStandard(artifact, { version = '', source = '' } = {}) {
  if (!artifact) throw new ContractError('Standard image has not been published')
  const labels = artifact.labels
  if (labels[label.edition] !== 'standard'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(labels[label.version] || '')
    || !/^[a-f0-9]{40}$/.test(labels[label.standardSource] || '')
    || !/^[a-f0-9]{64}$/.test(labels[label.tree] || '')) {
    throw new ContractError('Standard image is missing the release contract; rebuild Standard first')
  }
  if (version && labels[label.version] !== version) throw new ContractError('Standard DSH version mismatch')
  if (source && labels[label.standardSource] !== source) throw new ContractError('Standard source revision mismatch')
  return {
    image: artifact.image, digest: artifact.digest, version: labels[label.version],
    source: labels[label.standardSource], channels: labels[label.channels] || '',
    tree: labels[label.tree],
    track: labels[label.track] || '', releaseTag: labels[label.releaseTag] || '',
  }
}

export class Registry {
  constructor(image, { fetcher = fetch, token = process.env.GH_TOKEN || '', actor = process.env.GITHUB_ACTOR || 'token' } = {}) {
    imageReference(image, image + ':latest')
    this.image = image
    this.repository = image.slice('ghcr.io/'.length)
    this.fetcher = fetcher
    this.credentials = token ? 'Basic ' + Buffer.from(actor + ':' + token).toString('base64') : ''
  }

  async request(url, headers = {}, missingOK = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response
      try {
        response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'follow' })
      } catch (error) {
        if (attempt === 2) throw error
        continue
      }
      if (missingOK && response.status === 404) return null
      if (response.ok) return response
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }
      throw new Error(`Registry request failed (${response.status}): ${new URL(url).pathname}`)
    }
  }

  async authorization() {
    if (!this.bearer) {
      const query = new URLSearchParams({ service: 'ghcr.io', scope: `repository:${this.repository}:pull` })
      const response = await this.request('https://ghcr.io/token?' + query,
        this.credentials ? { Authorization: this.credentials } : {})
      this.bearer = (await response.json()).token
      if (!this.bearer) throw new Error('GHCR did not return a pull token')
    }
    return { Authorization: 'Bearer ' + this.bearer, Accept: accept }
  }

  async document(kind, reference, missingOK = false) {
    const response = await this.request(`https://ghcr.io/v2/${this.repository}/${kind}/${reference}`,
      await this.authorization(), missingOK)
    if (!response) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    const declared = response.headers.get('docker-content-digest')
    if ((declared && declared !== digest) || (reference.startsWith('sha256:') && reference !== digest)) {
      throw new ContractError('Registry content digest mismatch')
    }
    return { digest, value: JSON.parse(bytes.toString('utf8')) }
  }

  async inspect(reference, { missingOK = false } = {}) {
    const ref = imageReference(this.image, reference)
    const root = await this.document('manifests', ref, missingOK)
    if (!root) return null
    const manifests = root.value.manifests
    if (!Array.isArray(manifests)) throw new ContractError('Release must contain a multi-platform index')
    const labelsByPlatform = []
    for (const architecture of ['amd64', 'arm64']) {
      const descriptors = manifests.filter(m => m.platform?.os === 'linux' && m.platform?.architecture === architecture)
      if (descriptors.length !== 1) throw new ContractError('Missing or duplicate linux/' + architecture)
      if (!digestPattern.test(descriptors[0].digest)) throw new ContractError('Invalid platform manifest digest')
      const manifest = await this.document('manifests', descriptors[0].digest)
      if (!digestPattern.test(manifest.value.config?.digest || '')) throw new ContractError('Invalid image config digest')
      const config = (await this.document('blobs', manifest.value.config.digest)).value
      if (config.os !== 'linux' || config.architecture !== architecture) throw new ContractError('Platform/config mismatch')
      labelsByPlatform.push(config.config?.Labels || {})
    }
    for (const key of [...Object.values(label), 'org.opencontainers.image.revision']) {
      if (labelsByPlatform[0][key] !== labelsByPlatform[1][key]) {
        throw new ContractError('Platform release labels disagree: ' + key)
      }
    }
    return { image: this.image + '@' + root.digest, digest: root.digest, labels: labelsByPlatform[0] }
  }
}
