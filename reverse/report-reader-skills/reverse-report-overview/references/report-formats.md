# Report fields and interpretation

These are fields emitted by this repository, not a schema guarantee for arbitrary reports. Inspect the actual `schema` and keys before using a field. Missing data remains unknown.

| Schema | Useful fields | Interpretation limit |
| --- | --- | --- |
| `dsh-reverse-evidence/v1` | `generated_at`, `sample.path/sha256/size`, `analysis.format/lief/archive/capa`, `evidence[]`, `warnings`, `limitations` | Header evidence and static capability matches do not establish runtime behavior. `analysis.capa.status` may be unavailable; absence of the field can mean capa was not requested. |
| `dsh-reverse-ghidra/v2` | `program`, `image_base`, `functions[].address/name/signature/pseudocode/warning`, `call_graph`, `references`, `limitations` | No sample SHA-256 is exported here. Seek identity in an associated task or case. Exported functions and text are bounded, so even `call_graph.truncated: false` does not mean a whole-program graph. |
| `dsh-reverse-js-triage/v1` | `source`, `files_scanned`, `bytes_scanned`, `entries[].path/sha256/signals/package`, `warnings`, `limitations` | Hashes are per file. Signal counts are heuristic matches, capped at 100 per signal; scans exclude dependency/build directories and have file/byte limits. No match is not proof a behavior is absent. |
| `dsh-reverse-diff/v1` | `left_program`, `right_program`, `functions_added/removed/modified`, `edges_added/removed`, `limitations` | Function matching is by address. Changed layout or decompiler output can resemble semantic changes. Program names alone do not bind the input files to versions. |
| `dsh-reverse-workspace/v1` | `generated_at`, `reports[].path/schema/sha256/size`, `limitations` | Hashes describe report bytes at index creation, not target samples or analytical truth. Reading the index does not verify current files. |
| `dsh-reverse-workspace-verification/v1` | `passed`, `results[].path/verified` | A stored result describes a past file-integrity check. It is not behavioral validation and does not establish that files stayed unchanged afterward. |
| `dsh-reverse-case/v1` | `target`, `goal`, `deliverable`, `gates`, `evidence`, `hypotheses`, `experiments`, `tasks` | Evidence grades, gates and hypothesis assessments are recorded assertions. Trace their linked artifacts and observations before accepting the conclusion. |
| `dsh-reverse-task/v1` | `id`, `kind`, `inputs`, `case_id` when present, `state`, `attempts`, `result`, `last_error`, `events` | Success describes execution status. Read warnings and actual output before calling analysis complete. Log tails may be truncated. |

## Ghidra locators

Cite, for example, `functions.json: functions[3].pseudocode, address 00401230`. `references.entries[].from/target/type` describes direct entry-point references, not all references to the function body. Call edges connect exported functions; indirect and out-of-scope calls may be absent. A missing `warning` does not remove the fixed pseudocode length cap.

## Case locators

`target` includes `kind`, `path`, `sha256` and `size`; a directory additionally has `file_count` and uses a directory-content digest.

`evidence[]` links `id`, `artifact.path/sha256/size`, `locator`, `observation`, `grade` and `tool`. Follow hypothesis `evidence_ids` and experiment `hypothesis_id/evidence_ids`; do not substitute a successful task for the experiment's actual observation. `G1` is an operator declaration; recorded passed gates are not independent certification.

## Reading without verification tools

The report reader has reading, search, Skill-loading and bounded report-MCP tools.
The MCP computes source hashes only for the report/document bytes it reads.
It cannot claim it ran `reverse-case verify`, recomputed a sample hash, executed
a sample, or reproduced a reported experiment. For stored verification results,
say "the record reports verification" and retain the source/time limitations.
