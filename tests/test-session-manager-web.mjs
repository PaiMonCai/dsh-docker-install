import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { apply, ENDPOINT } from '../docker/plugins/dsh-session-manager-web/index.js'

// Exercise the actual browser plugin with a small React/slots stand-in.
// It must remain Chinese and use DSH's native red destructive menu styling,
// even when the Web UI/browser is configured in English.
const browserClient = await readFile(new URL('../docker/plugins/dsh-session-manager-web/client.js', import.meta.url), 'utf8')
for (const language of ['en-US', 'zh-CN']) {
  const components = new Map()
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children } }
    },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot() },
    useState(initial) { return [initial, () => {}] },
    useEffect() {},
  }
  let browserPlugin
  runInNewContext(browserClient, {
    document: { documentElement: { lang: language } },
    navigator: { language },
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          browserPlugin = factory(id => {
            if (id === 'react') return React
            if (id === '@deepseek-ai/dsh-client-ui-primitives') {
              return { MenuItemButton: 'MenuItemButton', Modal: 'Modal' }
            }
            throw new Error('Unexpected browser dependency: ' + id)
          })
        },
      },
    },
  })
  browserPlugin.apply({
    slots: {
      inject(_name, register) { register() },
      register({ name }, Component) { components.set(name, Component) },
    },
  })
  const Menu = components.get('sidebar.workspaces.session.menu.item')
  const Overlay = components.get('shell.overlay')
  assert.equal(typeof Menu, 'function')
  assert.equal(typeof Overlay, 'function')
  let closed = false
  const action = Menu({
    sessionId: 'session-ui-test',
    displayTitle: '测试会话',
    useMenuOpenState: () => [true, () => { closed = true }],
  })
  assert.equal(action.type, 'MenuItemButton')
  assert.equal(action.props.children[0], '删除会话…')
  assert.equal(action.props.danger, true)
  assert.equal(action.props.separatorBefore, true)
  action.props.onSelect()
  assert.equal(closed, true)
  const dialog = Overlay()
  assert.equal(dialog.type, 'Modal')
  assert.equal(dialog.props.title, '删除会话')
  assert.equal(dialog.props.closeLabel, '取消')
  assert.equal(dialog.props.description, '测试会话')
  assert.match(dialog.props.children[0].props.children[0], /会话将移入回收区/)
  const confirmButton = dialog.props.footer.props.children[1]
  assert.equal(confirmButton.props.children[0], '删除并重启')
  assert.equal(confirmButton.props.style.color, '#dc2626')
}

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
