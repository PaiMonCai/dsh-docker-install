/**
 * Durable settings in the existing DSH_HOME volume.
 * Synchronous operations serialize RPC saves inside the sole Web host process.
 * Defensive path checks, bounded no-follow reads, revision/CAS and atomic fsync.
 */
import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, mkdirSync, openSync, readSync, fstatSync,
  writeFileSync, fsyncSync, renameSync, unlinkSync, closeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defaults, normalizeSettings } from './policy.mjs'

const LIMIT = 32768
export const relativePath = 'dsh-docker/context-manager/settings.json'
function directory(home, create = false) {
  let path = resolve(home || process.env.DSH_HOME || '/root/.dsh')
  for (const segment of ['', 'dsh-docker', 'context-manager']) {
    if (segment) path = join(path, segment)
    let stat
    try { stat = lstatSync(path) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      if (!create) return null
      mkdirSync(path, { mode: 0o700 })
      stat = lstatSync(path)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('unsafe settings directory')
  }
  return path
}
function statFile(file) {
  try { return lstatSync(file) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}
function content(file) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > LIMIT) throw Error('unsafe settings file')
    const buffer = Buffer.alloc(LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null)
      if (!n) break
      length += n
    }
    if (length > LIMIT) throw Error('oversized settings file')
    return buffer.subarray(0, length).toString('utf8')
  } finally { if (fd !== undefined) closeSync(fd) }
}
export function settingsPath(home) {
  return join(resolve(home || process.env.DSH_HOME || '/root/.dsh'), relativePath)
}
export function readSettings(home) {
  const dir = directory(home)
  if (!dir) return defaults()
  const file = join(dir, 'settings.json')
  const stat = statFile(file)
  if (!stat) return defaults()
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) throw Error('unsafe settings file')
  let data
  try { data = JSON.parse(content(file)) }
  catch { throw Error('invalid settings JSON') }
  return normalizeSettings(data)
}
export function settingsRevision(settings) {
  return createHash('sha256').update(JSON.stringify(normalizeSettings(settings))).digest('hex')
}
export function writeSettings(settings, expectedRevision, home) {
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))
    throw Error('settings revision required')
  const normalized = normalizeSettings(settings)
  if (expectedRevision !== settingsRevision(readSettings(home)))
    throw Error('settings changed in another page; refresh before saving')
  const dir = directory(home, true)
  const file = join(dir, 'settings.json')
  const previous = statFile(file)
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw Error('unsafe settings file')
  const temp = join(dir, '.settings-' + randomUUID() + '.json')
  let fd
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(normalized) + '\n')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temp, file)
    const dirFd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY)
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  return normalized
}
