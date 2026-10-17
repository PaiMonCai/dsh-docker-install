---
name: reverse-report-finding-check
description: Review whether a specific reported security finding is supported, disputed or still unverified using existing code extracts and evidence. Use for suspected false positives, exploitability claims or an important finding selected during triage; does not reproduce bugs.
license: CC-BY-SA-4.0
---
# Check a Reported Finding

Reading-only adaptation of Trail of Bits' `fp-check`; source, modifications and
license are in [attribution.md](references/attribution.md).

## Restate before judging

Write the exact claim in one sentence: component/version, trigger, alleged root
cause, security boundary and impact. Separate a dangerous-looking pattern from
an attacker-reachable violation. Ask for clarification only when the inspected
material cannot resolve an ambiguity that changes the conclusion.

## Inspect the support

Read the report's cited sources, callers, relevant guards and recorded test
observations. Track where attacker-controlled input enters, which
transformations or validations apply, and what sensitive operation it reaches.
Missing source regions remain gaps; a decompiler export is not a complete
source-to-sink proof.

Consider the strongest alternative explanation:

- upstream checks or a narrower call contract;
- privileges already required before the alleged gain;
- bounds, widths, lifetimes or ownership facts omitted from the report;
- race ordering and synchronization rather than one suspicious interleaving;
- test environment differences, disabled paths or a mismatched target version;
- a successful test that observed a different property from the claimed impact.

Inspect controls and expected-versus-observed results if experiments were
recorded. Never call a reproduction verified because a task completed or a
report says "confirmed". Keep hypotheses for different bugs separate; an
interaction or exploit chain needs its own connecting evidence.

## Give an evidence-bounded verdict

Use **supported within the inspected scope**, **refuted within the inspected
scope**, or **unresolved**. Do not force a true/false-positive verdict when the
necessary execution, caller or deployment evidence is absent.

Return the claim, verdict, decisive evidence locator, strongest alternative,
coverage limit and the smallest additional observation that would change the
verdict. If direct code or report records disagree, show both.

Use `reverse-report-evidence-audit` for a detailed provenance chain. Source
inspection, new tests, PoCs, task orchestration and writing a verification
report are engineering follow-ups, not actions provided by this Skill.
