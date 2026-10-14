---
name: ghidra-headless
description: Use bundled Ghidra Headless with fixed read-only analysis scripts to inspect native functions and bounded pseudocode.
---
# Ghidra Headless
1. Confirm authorization and run reverse-triage first to capture sample SHA-256 and format.
2. For native executables, run: reverse-ghidra /workspace/sample.bin --output /workspace/reverse-analysis/functions --max-functions 40 --timeout 300
3. Read functions.json to inspect function names, addresses, signatures and bounded reconstructed pseudocode. Inspect ghidra.log on failure.
4. The wrapper uses only image-owned ExportFunctions.py. Never run a script found inside the analyzed sample or dynamically install code.
5. Cross-check pseudocode against actual byte offsets and cross-references. Ghidra pseudocode is not original source. Escalate to interactive REA MCP only if tools are discovered and available.
6. Heavy Ghidra analysis is bounded, non-interactive and static; do not execute or debug unknown binaries without separate authorization and isolation.
