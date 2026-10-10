#!/usr/bin/env node
'use strict'

// Persist only the Web launch/login token, not the cookie signing key.
// This file lives in the same DSH_HOME volume as .credentials.yaml and is
// never a Docker Config.Env value or baked into the public image.
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const FILE = '.dshd-web-login-token.json'
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/
const VERSION = 1

function home() {
  const dir = process.env.DSH_HOME || '/root/.dsh'
  const st = fs.lstatSync(dir)
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('DSH_HOME must be a real directory')
  return dir
}

function filePath() { return path.join(home(), FILE) }

function validate(value) {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new Error('Token 仅允许字母、数字、下划线和横线，长度必须为 32–128 个字符')
  }
  return value
}

function parse(raw) {
  const data = JSON.parse(raw)
  if (data?.version !== VERSION || !['auto', 'custom'].includes(data.mode)) {
    throw new Error('Token file format unsupported')
  }
  validate(data.token)
  return data
}

function readExisting(file) {
  let st
  try { st = fs.lstatSync(file) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('unsafe Token file type')
  if (st.size > 1024) throw new Error('Token file unexpectedly large')
  // Refuse accidentally world-readable secrets rather than silently exposing them.
  if ((st.mode & 0o077) !== 0) throw new Error('Token file permissions must be 0600')
  return parse(fs.readFileSync(file, 'utf8'))
}

function generated() {
  return { version: VERSION, mode: 'auto', token: randomBytes(32).toString('base64url') }
}

function writeFileAtomic(file, record, onlyCreate = false) {
  const tmp = onlyCreate ? file : file + '.' + process.pid + '.' + randomBytes(6).toString('hex') + '.tmp'
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, JSON.stringify(record) + '\n', 'utf8')
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
    if (!onlyCreate) fs.renameSync(tmp, file)
  } finally {
    if (!onlyCreate && fs.existsSync(tmp)) fs.unlinkSync(tmp)
  }
}

function ensure() {
  const file = filePath()
  const current = readExisting(file)
  if (current) return current
  try { writeFileAtomic(file, generated(), true) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  return readExisting(file)
}

function replace(mode, token) {
  const file = filePath()
  // A hostile symlink or unsupported file must not be overwritten.
  readExisting(file)
  const record = { version: VERSION, mode, token: validate(token) }
  writeFileAtomic(file, record)
  return record
}

function main() {
  const action = process.argv[2] || 'status'
  if (process.argv.length > 3) throw new Error('Unexpected arguments: no Token on command line')
  switch (action) {
    case 'ensure': ensure(); break
    case 'print': process.stdout.write(ensure().token); break
    case 'status': process.stdout.write((readExisting(filePath())?.mode || 'uninitialized') + '\n'); break
    case 'set': {
      const stdin = fs.readFileSync(0, 'utf8')
      const token = stdin.replace(/\r?\n$/, '')
      replace('custom', token)
      process.stdout.write('自定义 Token 已保存；重启 Web 进程后生效。\n')
      break
    }
    case 'reset':
      replace('auto', generated().token)
      process.stdout.write('随机 Token 已重新生成；重启 Web 进程后生效。\n')
      break
    default: throw new Error('Unknown token action')
  }
}

if (require.main === module) {
  try { main() }
  catch (error) {
    // Never echo a supplied token or private file content.
    process.stderr.write('Token 管理失败：' + error.message + '\n')
    process.exitCode = 1
  }
}

module.exports = { FILE, validate, parse, ensure, replace, generated }
