/**
 * DSH native TieredCompactionEngine candidate.
 * This file is shipped but NOT mounted through a Cordis patch. A preset-level
 * replacement and owner-gated rollout is necessary before enabling it.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { makeNativeTieredEngine } from './tiered-backend.mjs'
const requireDsh=createRequire('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/package.json')
const basic = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-compaction-basic')).href)
const llm = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-llm')).href)
export default makeNativeTieredEngine(basic.BasicCompactionEngine,{BlockAssembler:llm.BlockAssembler})
