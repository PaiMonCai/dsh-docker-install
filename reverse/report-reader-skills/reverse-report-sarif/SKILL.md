---
name: reverse-report-sarif
description: Read existing SARIF 2.1.0 scanner reports, prioritize alerts and compare findings while preserving tool identity, locations, suppressions and uncertainty. Use for SARIF files from CodeQL, Semgrep or other scanners; not for native Reverse report JSON.
license: CC-BY-SA-4.0
---
# Review Existing SARIF Findings

Reading-only adaptation of Trail of Bits' `sarif-parsing`; see
[attribution.md](references/attribution.md).

Use `mcp__report_reader__read_sarif` for a local workspace report. It returns
overall counts, source-report SHA-256, tool/version, result JSON locators,
effective level, locations, baseline state and suppression statuses. The
hash identifies the report bytes read by this tool, not the analyzed sample.

## Read bounded pages

Start with a small page (`limit` at most 25). Use the returned `next_offset`
and the same filter to continue. The source hash must remain the same across
pages; if it changes, review the changed input as a new snapshot.

The `level` filter accepts `all`, `error`, `warning`, `note`, or `none`.
An error-only page is not a whole-report review. Cite both the input path and
`runs[i].results[j]`. Message and location truncation require reading the
corresponding JSON window with the native reader before detailed conclusions.

## Interpret scanner metadata correctly

- Result severity may be inherited from a rule; it need not be present on the
  result itself. The tool reports its resolution method and limitations.
- A scanner's level is not an independently justified business risk score.
- Suppression and baseline state are metadata, not proof of safety or a fix.
- Duplicate hints remain hints. Do not erase distinct tools, versions, targets
  or paths to reduce the finding count.
- File URIs, base IDs and line numbers are scanner-provided locators. The tool
  never follows them; use only user-supplied workspace artifacts to inspect
  backing code.
- Message-string indirection and invocation-level rule configuration overrides
  are not interpreted by the parser. If `severity_complete` is false, totals
  and severity filters are provisional: zero error rows cannot justify a clean
  scan. Inspect raw records when those features matter.
- Multiple runs may cover different targets. Matching rule IDs alone do not
  establish comparable inputs or independently corroborating evidence.

If the tool is unavailable or rejects an oversized/malformed input, disclose
the limitation and inspect bounded raw windows if feasible. Do not run jq,
install packages, scan code or report zero findings after a parser failure.

Route vulnerability prioritization to `reverse-report-triage` and disputed
alerts to `reverse-report-finding-check`. Compare existing scanner outputs
without claiming the Agent reproduced the underlying bug.
