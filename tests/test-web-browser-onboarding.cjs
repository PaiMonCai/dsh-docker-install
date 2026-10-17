'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { openCredentialForm, openSettingsPanel } = require('./web-browser-onboarding.cjs')

function fixture(flow, { brokenChoice = false } = {}) {
  let state = 'loading'
  const clicks = []
  const waits = []
  const credentialTitle = '\u6dfb\u52a0\u4e00\u4e2a API Key \u5f00\u59cb\u4f7f\u7528'
  const accountTitle = '\u5f00\u59cb\u4f7f\u7528'
  function locator(kind) {
    return {
      async isVisible() { return state === kind },
      or(other) {
        assert.equal(kind, 'credential')
        assert.equal(other, account)
        return {
          first() {
            return {
              async waitFor(options) {
                waits.push(options)
                state = flow
                if (!['account', 'credential'].includes(state)) throw Error('onboarding timeout')
              },
            }
          },
        }
      },
      async waitFor(options) {
        waits.push(options)
        if (state !== kind) throw Error('credential timeout')
      },
      getByRole(role, options) {
        assert.equal(role, 'button')
        assert.deepEqual(options, { name: '\u6dfb\u52a0 API Key', exact: true })
        return {
          async click() {
            assert.equal(state, 'account')
            clicks.push('api-key')
            if (!brokenChoice) state = 'credential'
          },
        }
      },
    }
  }
  const credential = locator('credential')
  const account = locator('account')
  const page = {
    getByRole(role, options) {
      assert.equal(role, 'dialog')
      assert.equal(options.exact, true)
      if (options.name === credentialTitle) return credential
      assert.equal(options.name, accountTitle)
      return account
    },
  }
  return { page, credential, clicks, waits }
}

test('legacy flow waits for the asynchronously mounted credential form', async () => {
  const f = fixture('credential')
  assert.equal(await openCredentialForm(f.page), f.credential)
  assert.deepEqual(f.clicks, [])
  assert.deepEqual(f.waits, Array(2).fill({ state: 'visible', timeout: 15000 }))
})

test('alpha.4 chooses API key without starting external account sign-in', async () => {
  const f = fixture('account')
  assert.equal(await openCredentialForm(f.page, 1234), f.credential)
  assert.deepEqual(f.clicks, ['api-key'])
  assert.deepEqual(f.waits, Array(2).fill({ state: 'visible', timeout: 1234 }))
})

test('missing onboarding is still a failure, not a skipped check', async () => {
  const f = fixture('missing')
  await assert.rejects(openCredentialForm(f.page), /onboarding timeout/)
})

test('account choice must actually open the credential form', async () => {
  const f = fixture('account', { brokenChoice: true })
  await assert.rejects(openCredentialForm(f.page), /credential timeout/)
})

function settingsFixture(flow, { brokenMenu = false } = {}) {
  let state = 'loading'
  const clicks = []
  function locator(kind) {
    return {
      async isVisible() { return state === kind },
      or(other) {
        assert.equal(kind, 'account')
        assert.equal(other, trigger)
        return { first: () => ({ async waitFor() { state = flow } }) }
      },
      async click() {
        assert.equal(state, kind)
        clicks.push(kind)
        state = kind === 'account' ? (brokenMenu ? 'missing' : 'menu') : 'panel'
      },
      async waitFor() { if (state !== kind) throw Error('settings panel timeout') },
    }
  }
  const account = locator('account'), trigger = locator('trigger')
  const menu = locator('menu'), panel = locator('panel')
  const page = { getByRole(role, options) {
    assert.equal(options.exact, true)
    if (role === 'button' && options.name === '\u8d26\u53f7\u83dc\u5355') return account
    assert.equal(options.name, '\u8bbe\u7f6e')
    if (role === 'button') return trigger
    if (role === 'menuitem') return menu
    assert.equal(role, 'dialog')
    return panel
  } }
  return { page, panel, clicks }
}

test('current account launcher opens native Settings through its menu item', async () => {
  const f = settingsFixture('account')
  assert.equal(await openSettingsPanel(f.page), f.panel)
  assert.deepEqual(f.clicks, ['account', 'menu'])
})

test('legacy standalone Settings trigger still opens the native panel', async () => {
  const f = settingsFixture('trigger')
  assert.equal(await openSettingsPanel(f.page), f.panel)
  assert.deepEqual(f.clicks, ['trigger'])
})

test('a missing account menu item cannot silently skip Settings acceptance', async () => {
  const f = settingsFixture('account', { brokenMenu: true })
  await assert.rejects(openSettingsPanel(f.page))
})
