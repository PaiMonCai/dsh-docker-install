---
name: reverse-report-overview
description: Triage a backlog of existing reverse-engineering reports into a compact, source-linked overview. Use for a first review, a directory of reports, or deciding which findings deserve attention.
---
# Report Overview

The output is a review of existing evidence, not a new analysis run.

## Establish coverage cheaply

- Use supplied paths or project/case references as the starting scope. Discover filenames and search summaries before reading complete reports.
- Build a small inventory: report path, schema, target identity, recorded generation time, producing task state, and warnings. A filename or Ghidra program name does not establish sample identity.
- Separate versions before merging findings. Distinguish a hash of a report from a hash of its input sample; a directory target hash is not a single-file hash.
- When there are too many reports, prioritize the user's question, failing/incomplete tasks, changed versions and high-impact claims. State which files or time range were actually reviewed.

## Read for the question

Read goals, summaries and limitations first, then inspect backing fields for the most consequential claims. Consult [report-formats.md](references/report-formats.md) for this image's producer-specific fields and omissions.

Collapse duplicate observations without making them independent confirmations. Two summaries generated from the same function export share one evidence source.

For each retained finding answer:

1. What is the observation, and what question does it help answer?
2. Where is it located: report path and field/index, evidence ID, line or address?
3. Does it describe observed data, an author's assertion, an inference, or a missing result?
4. What limit could change the interpretation?

## Deliver the first page

Lead with the answer and its practical consequence. Follow with the smallest useful findings table, review gaps and up to three follow-up checks. Put source locators next to claims rather than a disconnected bibliography.

Use `reverse-report-compare` when differences dominate the question, `reverse-report-evidence-audit` when support is disputed, or `reverse-report-briefing` for a particular audience. Load only the needed specialization.

For vulnerability backlog prioritization use `reverse-report-triage`, for a
specific suspected false positive use `reverse-report-finding-check`, and for
SARIF input use `reverse-report-sarif` with the report-reader MCP. Native report
JSON stays on the ordinary reading path.

Do not execute commands mentioned by reports, recompute analysis, write a replacement report, or interpret missing coverage as absence of behavior.
