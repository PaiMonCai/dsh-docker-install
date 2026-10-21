import {labReadiness} from './lab-readiness.mjs'

/** Live composition is evidence of mounting only, never of provider or tenant acceptance. */
export function rolloutReadiness(takeover,evidence,inventory) {
  const lab=labReadiness(takeover,evidence,inventory)
  const presets=(inventory?.presets??[]).map(row=>({
    preset:row.id,mounted:!!row.mounted,
    owner:row.ownership,
    isolatedAcpEligible:row.id==='standard'&&lab.active,
    acpToolsMounted:row.acp?.active===1,
    providerRouter:'not-observed',ccrRoundTrip:'not-observed',providerUsage:'not-observed',
    acceptance:'blocked',
  }))
  return {
    scope:'this-web-host-live-preset-inventory',readOnly:true,
    requestedStage:takeover?.active?'isolated-standard-lab':'disabled',
    observedStage:lab.active?'isolated-standard-lab':'not-proven',
    maximumActivationScope:'isolated-standard-preset',
    productionApproved:false,sharedHistoryApproved:false,
    presets,
    requiredEvidence:[
      'exact-commit-pr-and-isolated-image-ci',
      'two-controlled-real-provider-long-session-workloads',
      'provider-token-cache-latency-and-price-baseline',
      'principal-resource-authorized-shared-history-before-multitenancy',
      'per-edition-preset-router-toolruntime-ccr-and-usage-acceptance',
      'flags-off-container-recreate-cold-log-and-basic-rollback',
    ],
    labBlockers:lab.blockers,
    note:'No activation or authorization is granted by this report. Composition does not prove request execution.',
  }
}
