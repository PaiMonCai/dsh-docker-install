#!/usr/bin/env node
'use strict'
// Real Chromium smoke suite for the current DSH Web build. Run exclusively
// against an isolated CI container/volume. Never purge real user sessions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { chromium } = require('/usr/local/lib/node_modules/playwright')
const { resolveBindHost } = require('/usr/local/bin/resolve-bind-host.js')

const tokenFile = path.join(process.env.DSH_HOME || '/root/.dsh',
  '.dshd-web-login-token.json')
const port = Number(process.env.DSH_PORT || '3080')
const bindHost = resolveBindHost(process.env.DSH_BIND_HOST || '')
// Web binds to a concrete Docker-interface address while its trusted-host
// policy permits localhost. A private loopback-only TCP relay lets real
// Chromium send the correct Host header without relaxing server security.
let proxy
let base
const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token
if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw Error('invalid CI login token')

const timeout = 20000
let browser
let page

async function run() {
  proxy = net.createServer(client => {
    const upstream = net.connect({ host: bindHost, port })
    const close = () => { client.destroy(); upstream.destroy() }
    client.on('error', close)
    upstream.on('error', close)
    client.pipe(upstream)
    upstream.pipe(client)
  })
  await new Promise((resolve, reject) => {
    proxy.once('error', reject)
    proxy.listen(0, '127.0.0.1', resolve)
  })
  base = 'http://127.0.0.1:' + proxy.address().port
  browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROME_BIN || '/usr/local/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
  })
  page = await context.newPage()
  const clientErrors = []
  page.on('pageerror', error => clientErrors.push(error.message))
  // Do not log authenticated URLs, request/response cookies or tokens.
  await page.goto(base + '/?token=' + encodeURIComponent(token), {
    waitUntil: 'domcontentloaded', timeout: 25000,
  })
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 25000 })
  await page.waitForFunction(() => Boolean(window.__dshDockerIconDockV1?.getAll),
    null, { timeout })

  const dock = page.getByRole('group', { name: '快捷入口' })
  await dock.waitFor({ state: 'visible', timeout })
  const registered = await page.evaluate(() => window.__dshDockerIconDockV1.getAll()
    .map(item => ({ id: item.id, label: item.label })))
  assert.ok(registered.some(r => r.id === 'native-panel.plugins'),
    'native Plugins page was not registered in Icon Dock')
  assert.ok(registered.some(r => r.id === 'dsh-docker.session-recycle'),
    'recycle shortcut missing')
  assert.ok(await dock.getByRole('button', { name: '插件' }).isVisible(),
    'official Plugins icon is not visible')
  assert.ok(await dock.getByRole('button', { name: '回收站' }).isVisible(),
    'recycle icon is not visible')

  // The original text navigation should be suppressed by the native dock
  // adapter; this is the regression missed by the original headless tests.
  const original = page.locator('nav[class*="panelList"]')
  if (await original.count()) {
    assert.equal(await original.first().isVisible(), false,
      'native text panel navigation was not replaced by icon dock')
  }

  // Inject trusted test-only shortcuts through the public registration API.
  // No production plugin or persistent session is changed.
  await page.evaluate(() => {
    window.__dshE2eActions = []
    const dock = window.__dshDockerIconDockV1
    for (let i = 1; i <= 12; i++) {
      const key = 'e2e.shortcut-' + String(i).padStart(2, '0')
      dock.register({
        id: key, label: '验收图标 ' + i, icon: 'grid',
        order: 300 + i,
        onClick: () => window.__dshE2eActions.push(i),
      })
    }
  })
  const buttons = dock.locator('.dsh-icon-grid > button')
  await page.waitForFunction(() => document.querySelectorAll(
    '[aria-label="快捷入口"] .dsh-icon-grid > button').length === 10, null, { timeout })
  assert.equal(await buttons.count(), 10, '5x2 layout must render only ten slots')
  assert.equal(await buttons.last().getAttribute('aria-label'), '更多')
  const boxes = await Promise.all(Array.from({ length: 10 }, (_, i) => buttons.nth(i).boundingBox()))
  const uniqueRows = new Set(boxes.map(box => Math.round(box.y)))
  assert.equal(uniqueRows.size, 2, 'shortcut dock must have at most two rows')
  const firstRow = boxes.filter(b => Math.round(b.y) === Math.min(...boxes.map(x => Math.round(x.y))))
  assert.equal(firstRow.length, 5, 'wide dock must fit five icons per row')

  // Fresh DSH Profiles can open an upstream onboarding/workspace modal
  // on first visit. This modal deliberately intercepts pointer events.
  // DSH's official Modal closes on its backdrop; dismiss it through a
  // real user click rather than Playwright force-clicking through the mask.
  const startupBackdrop = page.locator('[role="presentation"] > [aria-hidden="true"]')
  if (await startupBackdrop.first().isVisible().catch(() => false)) {
    await startupBackdrop.first().click()
    await startupBackdrop.first().waitFor({ state: 'hidden', timeout: 5000 })
  }
  await buttons.last().click()
  const menu = page.getByRole('menu', { name: '更多快捷入口' })
  await menu.waitFor({ state: 'visible' })
  await menu.getByRole('menuitem', { name: '验收图标 12' }).click()
  const action12 = await page.evaluate(() => window.__dshE2eActions.includes(12))
  assert.ok(action12, 'More menu must run original contributor callback')
  assert.equal(await menu.isVisible(), false, 'More menu should close after selection')

  // Persist "更多/隐藏" and an explicit order across page reload. Newly
  // registered test shortcuts are recreated after reload on purpose.
  await page.evaluate(() => {
    const dock = window.__dshDockerIconDockV1
    dock.setLocation('e2e.shortcut-03', 'hidden')
    dock.setLocation('e2e.shortcut-04', 'more')
    dock.arrange('e2e.shortcut-07', 'e2e.shortcut-01', 'dock')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__dshDockerIconDockV1?.register),
    null, { timeout })
  await page.evaluate(() => {
    const dock = window.__dshDockerIconDockV1
    for (let i = 1; i <= 12; i++) {
      dock.register({
        id: 'e2e.shortcut-' + String(i).padStart(2, '0'),
        label: '验收图标 ' + i, icon: 'grid', order: 300 + i,
        onClick: () => {},
      })
    }
  })
  const result = await page.evaluate(() => {
    const dock = window.__dshDockerIconDockV1
    return {
      hidden: dock.locationOf('e2e.shortcut-03'),
      more: dock.locationOf('e2e.shortcut-04'),
      positions: dock.getAll().map(x => x.id),
    }
  })
  assert.equal(result.hidden, 'hidden')
  assert.equal(result.more, 'more')
  assert.ok(result.positions.indexOf('e2e.shortcut-07') <
    result.positions.indexOf('e2e.shortcut-01'), 'drag-style ordering lost across reload')

  // The editor must be reachable through the original Plugins page.
  await dock.getByRole('button', { name: '插件' }).click()
  const editorLink = page.getByText('快捷入口管理', { exact: true }).first()
  await editorLink.waitFor({ state: 'visible', timeout })
  await editorLink.click()
  await page.getByLabel('快捷栏布局预览').waitFor({ state: 'visible', timeout })
  const selects = page.getByLabel('显示位置 验收图标 03')
  await selects.waitFor({ state: 'visible' })
  assert.equal(await selects.inputValue(), 'hidden')

  // A collapsed sidebar may show 2x2 with overflow. The exact UI control
  // varies upstream, but our own responsive dock can be checked after a
  // viewport resize without relying on internal DOM classes.
  assert.ok(clientErrors.filter(s => /dsh-docker-icon-dock|renderIcon|sidebar/i.test(s)).length === 0,
    'browser reported sidebar/plugin errors: ' + clientErrors.join('; '))

  console.log('Browser E2E PASS: native dock, 5x2 More, actions, persistence, editor')
}

run().catch(async error => {
  // CI artifacts are optional; the screenshot never includes the token URL.
  if (page) {
    try {
      await page.screenshot({ path: '/tmp/dsh-web-e2e-failed.png', fullPage: true })
      console.error('Saved failure screenshot to /tmp/dsh-web-e2e-failed.png')
    } catch { /* page may already be closed */ }
  }
  console.error('Browser E2E FAIL: ' + String(error.message).replaceAll(token, '[REDACTED]'))
  process.exitCode = 1
}).finally(async () => {
  if (browser) await browser.close()
  if (proxy) {
    await new Promise(resolve => proxy.close(resolve))
  }
})
