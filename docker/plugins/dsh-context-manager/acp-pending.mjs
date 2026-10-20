/**
 * A narrowly scoped, per-Session handoff between the model's acp_compress tool
 * and the existing DSH native summarizer transaction. No global LLM interception.
 */
const active = new WeakMap()
const queued = new WeakMap()
// Single queued model-authored proposal per live Session, not per tool call.
// The native pressure middleware runs before the ACP pre-step consumer.
export function hasQueuedAcpSummary(session) {return queued.has(session)}
export function queueAcpSummary(session, proposal) {
  if(queued.has(session))throw Error('ACP proposal already queued in this Session')
  queued.set(session,proposal)
}
export function clearQueuedAcpSummary(session,proposal) {
  if(queued.get(session)===proposal)queued.delete(session)
}
export function currentAcpSummary(session) { return active.get(session) ?? null }
export async function withAcpSummary(session, proposal, run) {
  if (active.has(session)) throw Error('another ACP summary is active for this Session')
  active.set(session, proposal)
  try { return await run() }
  finally { active.delete(session) }
}
