/** Frozen pre-upgrade fixture, consumed by the installed DSH/kernel in the image. */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import * as runtime from '/opt/dsh/plugins/dsh-context-manager/acp-runtime.mjs'
import * as recovery from '/opt/dsh/plugins/dsh-context-manager/acp-recovery.mjs'
import * as pending from '/opt/dsh/plugins/dsh-context-manager/acp-pending.mjs'
import * as ccr from '/opt/dsh/plugins/dsh-context-manager/acp-ccr.mjs'
import { probeLegacySession, probeTieredAdapter } from '/opt/dsh/test-lib/context-manager-legacy-probe.mjs'

const require = createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const session = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
const fixture = JSON.parse(await readFile('/opt/dsh/test-fixtures/acp-0.0.101-session.json', 'utf8'))
const result = await probeLegacySession({ ...runtime, ...recovery, ...pending, ...ccr }, fixture, session)
const tiers = await probeTieredAdapter({ ...runtime, ...recovery, ...pending, ...ccr }, session)
console.log('DSH_CONTEXT_MANAGER_M0_LEGACY_PASS ' + JSON.stringify({ legacy: result, tiers }))
