/**
 * A narrowly scoped, per-Session handoff between the model's acp_compress tool
 * and the existing DSH native summarizer transaction. No global LLM interception.
 */
const active = new WeakMap()
export function currentAcpSummary(session) { return active.get(session) ?? null }
export async function withAcpSummary(session, proposal, run) {
  if (active.has(session)) throw Error('another ACP summary is active for this Session')
  active.set(session, proposal)
  try { return await run() }
  finally { active.delete(session) }
}
