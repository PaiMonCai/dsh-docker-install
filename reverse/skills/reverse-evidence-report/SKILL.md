---
name: reverse-evidence-report
description: Assemble verifiable reverse engineering findings with artifact hashes, locations, tools, uncertainties, and reproducibility limits.
---
# Reverse Evidence Report
1. Start from reverse-triage report.json, not from unreferenced interpretations.
2. Each evidence item must carry an id, producing tool, source locator (offset, function address or path), exact observation, and confidence class.
3. For Ghidra results cite functions.json names and addresses; distinguish reconstructed pseudocode from code bytes.
4. Separate observed facts, hypotheses and unsupported claims. Include warnings, tool versions, input SHA-256 and explicit static/dynamic limitations.
5. Keep source files unmodified. Outputs go to /workspace/reverse-analysis; avoid including passwords or private data.
6. Do not claim complete behavioral reconstruction without a separate, authorized dynamic verification step.
