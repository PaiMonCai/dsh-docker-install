'use strict'

async function openCredentialForm(page, timeout = 15000) {
  const credential = page.getByRole('dialog', {
    name: '添加一个 API Key 开始使用', exact: true,
  })
  const account = page.getByRole('dialog', { name: '开始使用', exact: true })
  // alpha.4 adds an account choice before the legacy API-key editor. Wait
  // for either flow rather than sampling visibility during async mounting.
  await credential.or(account).first().waitFor({ state: 'visible', timeout })
  if (await account.isVisible()) {
    await account.getByRole('button', { name: '添加 API Key', exact: true }).click()
  }
  await credential.waitFor({ state: 'visible', timeout })
  return credential
}

module.exports = { openCredentialForm }
