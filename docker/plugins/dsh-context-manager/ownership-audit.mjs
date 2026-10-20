/** Conservative diagnostic: a snapshot is not a proof of unique runtime ownership. */
export function auditOwnership(inventory, host) {
  const presets=inventory?.available ? inventory.presets ?? [] : []
  const rows=presets.map(p=>{
    const native=Number(p.basic?.active||0)
    const external=Number(p.external?.active||0)
    const duplicate=native>1||native>0&&external>0
    const suspect=duplicate||p.ownership==='conflict-risk'||p.ownership==='duplicate-native-risk'
    return {agentId:p.id,mounted:!!p.mounted,
      activeNative: native, activeExternal:external,
      state:suspect?'conflict-risk':native===1?'preset-native-observed':external>0?'external-observed':'unverified'}
  })
  return {
    // host.get('compaction') cannot inspect all child Agent scopes and an
    // out-of-process proxy is invisible. Even one active row is insufficient.
    status:rows.some(r=>r.state==='conflict-risk')?'conflict-risk':'unverified',
    safeToActivateTiered:false,ownerVerified:false,
    hostVisible:!!host?.available,hostScope:'host-only',
    activePresetCount:rows.filter(r=>r.mounted).length,
    presets:rows,
    blockers:[
      'single-compaction-service-owner-not-proven',
      'native-manual-compact-transaction-not-end-to-end-tested',
      'external-gateway-interception-not-observable',
      'tiered-backend-not-mounted',
    ],
  }
}
