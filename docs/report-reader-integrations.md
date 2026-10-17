# Report Reader: external Skills and MCP candidates

Reviewed on 2026-10-17 against primary repository documentation. Integration now
includes reading-only adaptations of the triage, finding-check and SARIF Skills,
plus a private MCP using MarkItDown 0.1.8 and MCP SDK 1.30.0. GhidraMCP is excluded
at the user's request. Docling remains an alternative, not an installed dependency.

The built-in reader pack is documented in [reverse-edition.md](reverse-edition.md).
It covers this repository's JSON and Markdown reports with native reading,
search and Skill-loading tools.

## Skills

All four candidates below belong to [Trail of Bits Skills](https://github.com/trailofbits/skills).
The reviewed repository revision is `5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0`.
The repository declares CC BY-SA 4.0. Each of the three adapted Skills includes
source attribution, modification notes and license links under its references.
The complete upstream plugins, hooks, commands and analysis agents are not bundled.

| Candidate | Useful scope | Fit for the report reader |
| --- | --- | --- |
| [vulnerability-triage-brocards](https://github.com/trailofbits/skills/blob/5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0/plugins/vulnerability-triage-brocards/skills/vulnerability-triage-brocards/SKILL.md) | Filter incoming vulnerability findings by threat model, reachability, claimed impact and supporting information. | Closest to reviewing an automated finding backlog. Apply only to vulnerability claims. Missing evidence in a bounded report should remain unresolved, not automatically become a false-positive verdict. |
| [fp-check](https://github.com/trailofbits/skills/blob/5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0/plugins/fp-check/skills/fp-check/SKILL.md) | Restate a claim, inspect source-to-sink reasoning, preconditions and alternative explanations. | Useful review questions, but its full verification workflow includes command, write and delegated analysis tools. It cannot be installed unchanged as an executable workflow for this reading-only preset. |
| [sarif-parsing](https://github.com/trailofbits/skills/blob/5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0/plugins/static-analysis/skills/sarif-parsing/SKILL.md) | Read, filter, deduplicate and compare existing SARIF scan results. | Useful when actual SARIF inputs are present. The native Reverse report schemas are not SARIF. Its jq/Python recipes need an explicitly designed parsing tool or a reading-only adaptation. |
| [differential-review](https://github.com/trailofbits/skills/blob/5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0/plugins/differential-review/skills/differential-review/SKILL.md) | Review source-code changes with Git history, callers and tests. | Better suited to the engineering Agent. Comparing report artifacts does not provide the Git history and execution evidence required by its complete workflow. |

DSH loading a `SKILL.md` does not supply a Claude plugin's hooks, named analysis
agents, command tools or task APIs. Adapt references and required tools explicitly
before treating any complete upstream plugin as compatible.

## MCP

| Candidate | Documented capability | Integration assessment |
| --- | --- | --- |
| [Microsoft MarkItDown-MCP](https://github.com/microsoft/markitdown/blob/4cc9fa17653d695d64fb9eee5b33d4de55ff84e8/packages/markitdown-mcp/README.md) | One `convert_to_markdown(uri)` tool; stdio, Streamable HTTP and SSE; accepts file, HTTP, HTTPS and data URIs. | First document-conversion candidate if PDF/Office inputs become common. A stdio subprocess could live inside the existing DSH container. Restrict local paths and URI schemes before exposing it to the reader; the upstream tool is not workspace-limited. Keep the original document and distinguish converted-text locators from original page/line locators. |
| [Docling MCP](https://github.com/docling-project/docling-mcp/blob/5e1551a9b984f9a26349de6d23d02eccf5a69db2/README.md) | PDF-to-structured-document conversion, OCR, table detection, document generation and optional RAG tools; local or remote conversion. | Candidate for scanned PDFs and complex tables. For this architecture evaluate local mode with stdio and only the needed conversion/query tools. Do not enable generation, RAG or remote document transfer by default. Model and conversion costs require an actual-image evaluation. |
| [GhidraMCP](https://github.com/LaurieWired/GhidraMCP/blob/1e980252087b2479a21b9ca6d82d5829538651a7/README.md) | Ghidra decompilation and analysis, listing functions/imports/exports, and renaming methods/data; GUI plugin or headless operation. | Excluded at the user's request. |

## Implemented boundary

The reader now has seven isolated Skills. Its `report_reader` stdio MCP exposes
only `read_sarif` and `read_document`. It accepts bounded local workspace files,
never fetches supplied URIs, retains source-byte hashes and does not write
converted reports. SARIF paging preserves suppressed and duplicate rows.

Document conversion directly selects MarkItDown's PDF/DOCX/XLSX/PPTX converters,
without the unrestricted URI interface of the upstream MCP package. Conversion
runs in a timed subprocess, with network socket connections disabled and Linux
CPU/address-space limits. This is not an OS security sandbox. OCR, document
generation, cloud conversion, RAG and runtime dependency installation are absent.
The parser's message/configuration limits and document-text truncation are
reported explicitly. See [reverse-edition.md](reverse-edition.md) for exact limits.

Tests exercise actual converters and standard MCP stdio initialization,
discovery and tool calls. The image/boot workflow additionally creates both
native presets through DSH. Local checks do not claim a Linux container boot
or model-quality evaluation; the matching image must pass CI before release promotion.
