---
name: reverse-evidence-report
description: Keep reproducible provenance-aware reverse engineering notebooks, phases, hypotheses and final reports for authorized investigations.
---
# Evidence-led Reverse Reports
- One target per DSH session. Start with reverse_environment_check, understanding it does not prove an REA MCP handshake; inspect the actual MCP tool list separately.
- Use reverse_project_open with exact target, kind and question. For resumed sessions call reverse_project_status first.
- Progress in order: scope -> inventory -> analysis -> validation -> report, using reverse_phase_advance only after real work.
- Use reverse_evidence_add with observed only when the exact tool and evidence ID or file/function/offset are known. Mark guesses inferred, unresolved items unknown.
- Bound evidence pages and tool output. The notebook cannot verify whether evidence IDs came from REA.
- Report artifact identity and SHA-256, observed findings, provenance, reasoning, validation, confidence, limits and unanswered questions.
- Export using reverse_report_export. Review citations against original evidence and remove secrets before sharing.
Never invent addresses, function names, tool success, source identifiers or recovered original source.
