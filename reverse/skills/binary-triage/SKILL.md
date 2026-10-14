---
name: binary-triage
description: Classify authorized ELF, PE, Mach-O and archives with read-only static analysis, LIEF, optional capa, and structured evidence reports.
---
# Binary Triage
1. Confirm authorization and that the sample is under /workspace. Never execute the target.
2. Run: reverse-triage /workspace/sample.bin
3. Open the returned report.json and report.md. Record SHA-256, header-based format, LIEF results, tool status, warnings and evidence locations.
4. On ELF or PE samples only, optionally request bounded capability classification: reverse-triage /workspace/sample.bin --capa
5. Do not infer a runtime behavior merely from a rule match, import, string or packer heuristic. Prefer Ghidra when deeper static function analysis is necessary.
6. Never extract unknown archives into /workspace automatically. Keep source bytes unchanged and avoid copying embedded secrets into chat or reports.
