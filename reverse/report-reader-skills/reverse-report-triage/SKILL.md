---
name: reverse-report-triage
description: Triage existing vulnerability reports or an automated security-finding backlog by threat model, attacker prerequisites, reachability and demonstrated impact. Use to decide which findings deserve human attention; ordinary behavior reports use reverse-report-overview.
license: CC-BY-SA-4.0
---
# Vulnerability Report Triage

This is a reading-only adaptation of Trail of Bits' vulnerability triage
methodology. See [attribution.md](references/attribution.md) for source, license
and adaptation notes.

## Establish the claim

For each candidate, locate the target version, the security boundary allegedly
crossed, the attacker's initial capabilities, the triggering input and the
claimed additional capability or harm. Keep missing prerequisites explicit.

Check these questions against cited report artifacts:

- Does the report identify a credible attacker and a concrete harmful outcome?
- Would the attacker already need privileges that grant the claimed outcome?
- Is the relevant path reachable in the recorded deployment and configuration?
- What specification and documented contract apply? If the component promises a
  stricter guarantee, test the claim against that guarantee.
- Is the issue in this component or in its caller's integration?
- What evidence supports the impact and the proposed remediation's tradeoffs?
- Does the technical account stand on its own without relying on a CVE number,
  severity label, repeated summaries or the reputation of its author?

Documented or specification-compliant behavior does not by itself establish
safety. Missing caller data in a partial report does not prove unreachability.
Do not dismiss a finding because a fix is inconvenient.

## Allocate review effort

Use one of three dispositions:

| Disposition | Required support |
| --- | --- |
| Prioritize review | A coherent security claim with relevant evidence; remaining proof needs are named. This is not a confirmed exploit verdict. |
| Needs more information | State the missing prerequisite, locator, control or observation and the question it would answer. |
| Not supported in the reviewed scope | Cite concrete contradictory evidence or a demonstrated mismatch in target, scope or prerequisites. Keep other deployments unresolved. |

Collapse repeated claims only when they share the same underlying evidence and
target identity. Keep each original locator. Severity and remediation effort
must remain separate from evidence sufficiency.

Return a compact table: finding, disposition, decisive evidence, missing proof,
and suggested next reviewer. Route disputed support to
`reverse-report-finding-check`. Recommend any reproduction or new analysis to
the engineering Agent; do not perform it or modify a finding ledger.
