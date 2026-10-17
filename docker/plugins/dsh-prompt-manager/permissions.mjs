/** Adapter to DSH's permission owner. No shadow sandbox or approval state. */
function safeSession(ctx, id) {
  if (!ctx) throw Error('official permission services unavailable')
  if (typeof id !== 'string' || !/^session-[A-Za-z0-9_-]{1,120}$/.test(id)) throw Error('invalid session ID')
  const session = ctx.sessions.get(id)
  if (!session || session.id !== id) throw Error('session is not currently loaded')
  return session
}

export function permissionStatus(ctx, tools) {
  if (!ctx) return { available: false, sessions: [], options: [], tools: [] }
  const catalog = ctx.permissionPresets.catalog()
  const names = new Set(tools ? tools.schemas().map(tool => tool.name) : [])
  const sessions = ctx.sessions.list().slice(0, 100).map(session => {
    const agent = ctx.agents.get(session.id)
    if (agent && tools) for (const tool of tools.schemas(agent)) names.add(tool.name)
    return { id: session.id, title: String(session.header?.title || session.id).slice(0, 160),
      running: agent?.status === 'running', preset: ctx.permissionPresets.current(session),
      sandbox: ctx.sandboxPolicy.resolve({ session }).mode,
      approval: ctx.approval.effectivePolicy(session) }
  })
  return { available: true, defaultPreset: catalog.defaultPreset,
    options: catalog.options, sessions, tools: [...names].sort().slice(0, 256) }
}

export function setPermission(ctx, payload) {
  const session = safeSession(ctx, payload.sessionId)
  if (typeof payload.preset !== 'string' ||
      !ctx.permissionPresets.catalog().options.some(option => option.value === payload.preset))
    throw Error('unknown or unavailable official permission preset')
  if (ctx.agents.get(session.id)?.status === 'running')
    throw Error('stop the running session before changing its permission preset')
  // Canonical owner writes permission/preset, sandbox/mode and approval/policy.
  ctx.permissionPresets.set(session, payload.preset)
  return { id: session.id, preset: ctx.permissionPresets.current(session),
    sandbox: ctx.sandboxPolicy.resolve({ session }).mode,
    approval: ctx.approval.effectivePolicy(session) }
}
