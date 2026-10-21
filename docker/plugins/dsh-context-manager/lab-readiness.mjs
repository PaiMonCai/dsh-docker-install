/**
 * Truthful evidence for the experimental Standard preset ONLY.
 * "active" does not imply per-user access control, provider routing,
 * no external proxy, or approval for production.
 */
export function labReadiness(takeover,evidence,inventory) {
 const row=inventory?.available&&inventory?.presets?.find(p=>p.id==='standard')
 const blockers=[]
 if(!inventory?.available||inventory.truncated)blockers.push('runtime-inventory-incomplete')
 if(row?.broken||row?.rowLimitReached)blockers.push('preset-inventory-incomplete')
 if(['tiered','basic','manual','acp','external'].some(key=>row?.[key]?.conditional>0))
   blockers.push('conditional-owner-unverified')
 if(!takeover?.active)blockers.push('pilot-not-enabled')
 if(!evidence||evidence.preset!=='standard')blockers.push('preset-overlay-not-observed')
 if(!row?.mounted)blockers.push('standard-not-mounted')
 if(row?.tiered?.active!==1)blockers.push('single-tiered-owner-not-active')
 if(row?.basic?.active!==0)blockers.push('upstream-basic-still-active')
 if(row?.manual?.active!==1)blockers.push('manual-compact-sibling-not-active')
 if(row?.external?.active!==0||row?.external?.configured!==0)
   blockers.push('conflicting-external-plugin')
 if(takeover?.acp&&row?.acp?.active!==1)
   blockers.push('native-acp-tools-not-active')
 return {
  scope:'standard-preset-lab-only',
  active:blockers.length===0,
  nativeAcp:!!takeover?.acp,
  nativeCcr:blockers.length===0&&!!takeover?.acp&&process.env.DSH_CONTEXT_MANAGER_CCR_ACTIVE==='1',
  productionApproved:false,
  blockers,
 }
}
