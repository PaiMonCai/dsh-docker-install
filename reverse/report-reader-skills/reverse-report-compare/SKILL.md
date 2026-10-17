---
name: reverse-report-compare
description: Compare existing reverse-engineering reports or versions, separating real changes, duplicate evidence, coverage differences and conflicting conclusions. Use for before/after reports or disagreeing analyses.
---
# Compare Reports

## Make the comparison valid

Establish each side's target identity, report generation context, tool versions when recorded, scope and completion status. Keep missing metadata explicit.

Distinguish three questions:

- Same artifact, different reports: differences may come from tools, coverage or interpretation.
- Different artifact versions: report differences may represent a target change.
- Uncertain identity: describe differences in the reports without attributing them to a target change.

Prefer recorded sample hashes over names. Report hashes identify report files. JS per-file hashes and case directory hashes have different meanings and cannot be substituted for a binary sample hash.

## Align evidence before claims

Use evidence IDs within their originating case/report, then available function address, qualified name, signature and surrounding call context. An `E001` in another report need not identify the same observation.

Address matching is only a starting point across binary versions: relinking or a changed image base can move equivalent functions. Name matching is also weak under stripping or obfuscation. Without a supported correspondence, label the pairing tentative.

For each important difference, retain locators on both sides and classify:

| Difference | What to check |
| --- | --- |
| Added or removed finding | Was that region covered on both sides, with comparable limits? |
| Changed pseudocode | Could tool version, export cap, naming or type recovery explain it? |
| Changed call edge | Were both endpoints exported, and were direct/indirect calls treated alike? |
| Contradictory conclusion | Does the underlying observation conflict, or only its interpretation? |
| Repeated conclusion | Do the reports reuse the same underlying evidence? |

Read only the relevant windows/functions, expanding when identity or coverage is ambiguous. A report date alone does not make one conclusion authoritative.

## Return a change-focused review

Start with the differences that affect the user's question. Use a compact table: question/finding, left evidence, right evidence, explanation, confidence/remaining gap.

Keep "not covered", "not observed" and "removed" distinct. Do not count a capability as fixed or newly introduced from string matches, task status or an address-based diff alone.

Propose the smallest follow-up needed to separate competing explanations; do not execute it or rerun the comparison tool.
