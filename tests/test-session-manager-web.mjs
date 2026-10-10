import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { apply, ENDPOINT } from '../docker/plugins/dsh-session-manager-web/index.js'

const home = await mkdtemp(join(tmpdir(), 'dsh-web-sessions-'))
const oldHome = process.env.DSH_HOME
const oldRestart = process.env.DSH_DOCKER_RESTART
process.env.DSH_HOME = home
process.env.DSH_DOCKER_RESTART = ''
const id = 'session-12345678-abcd'
const project = '--workspace--'
const session = join(home, 'sessions', project, id)

async function request(listener, method, input) {
  const req = Readable.from([Buffer.from(JSON.stringify(input))])
  req.url = ENDPOINT
  req.method = method
  let status = 0, body = ''
  const res = {
    writableEnded: false,
    writeHead(code) { status = code },
    end(chunk = '') { body += chunk; this.writableEnded = true },
  }
  await listener(req, res, async () => { throw new Error('should not call next') })
  return { status, data: JSON.parse(body) }
}

try {
  await mkdir(session, { recursive: true })
  await writeFile(join(session, 'session.v4.jsonl'), '{}\n')

  let handler
  const ctx = {
    sessionPersistence: {
      async stat(sessionId) { return sessionId === id ? { header: { id: sessionId } } : undefined },
    },
    on(event, callback) { assert.equal(event, 'connection/request'); handler = callback },
    logger: { warn() {} },
  }
  apply(ctx)
  assert.equal(typeof handler, 'function')
  assert.equal((await request(handler, 'GET', { sessionId: id })).status, 405)
  assert.equal((await request(handler, 'POST', { sessionId: '../bad' })).status, 400)
  assert.equal((await request(handler, 'POST', { sessionId: 'session-nope' })).status, 404)
  const done = await request(handler, 'POST', { sessionId: id })
  assert.deepEqual(done, { status: 202, data: { queued: true, restartScheduled: false } })
  const queueDir = join(home, '.dshd-session-manager')
  assert.equal(await readFile(join(queueDir, 'pending'), 'utf8'), project + '/' + id + '\n')
  const applying = spawnSync('bash', ['docker/apply-session-deletions.sh'], {
    env: { ...process.env, DSH_HOME: home, DSH_SESSION_MANAGER_BIN: join(process.cwd(), 'docker/plugins/dsh-session-manager/dsh-session-manager') },
    encoding: 'utf8',
  })
  assert.equal(applying.status, 0, applying.stderr)
  const trash = spawnSync('bash', ['docker/plugins/dsh-session-manager/dsh-session-manager', 'trash'], {
    env: { ...process.env, DSH_SESSION_DATA_ROOT: home }, encoding: 'utf8',
  })
  assert.equal(trash.status, 0, trash.stderr)
  assert.match(trash.stdout, new RegExp(project + '/' + id))
  assert.deepEqual(await readdir(join(home, 'sessions')).catch(() => []), [])
  assert.equal(await readFile(join(queueDir, 'pending'), 'utf8').catch(()=>''), '')

  const second = 'session-abcd5678'
  const dir = join(home,'sessions',project,second)
  await mkdir(dir,{recursive:true})
  await writeFile(join(dir,'session.v4.jsonl'),'{}\n')
  await symlink(dir,join(home,'sessions',project,'session-symlink'))
  assert.equal((await request(handler,'POST',{sessionId:'session-symlink'})).status,404)
  console.log('Web session manager queue, authentication hook, and offline application tests passed')
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldRestart === undefined) delete process.env.DSH_DOCKER_RESTART
  else process.env.DSH_DOCKER_RESTART = oldRestart
  await rm(home, { recursive: true, force: true })
}
