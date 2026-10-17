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

async function openSettingsPanel(page, timeout = 15000) {
  const account = page.getByRole('button', { name: '账号菜单', exact: true })
  const trigger = page.getByRole('button', { name: '设置', exact: true })
  // Current Web uses the account launcher; older compositions keep the
  // standalone Settings button. Both open the same native settings dialog.
  await account.or(trigger).first().waitFor({ state: 'visible', timeout })
  if (await account.isVisible()) {
    await account.click()
    await page.getByRole('menuitem', { name: '设置', exact: true }).click({ timeout })
  } else {
    await trigger.click()
  }
  const panel = page.getByRole('dialog', { name: '设置', exact: true })
  await panel.waitFor({ state: 'visible', timeout })
  return panel
}

module.exports = { openCredentialForm, openSettingsPanel }
