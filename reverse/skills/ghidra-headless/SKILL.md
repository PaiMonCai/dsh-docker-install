---
name: ghidra-headless
description: Use installed Ghidra analyzeHeadless for static authorized native binary function, call-graph and pseudocode investigations.
---
# Ghidra Headless
Use for native binaries when symbols, functions, call chains or pseudocode are needed, and source code is unavailable.
- In this image the analyzer is /opt/ghidra/support/analyzeHeadless with Java 21.
- Triage the sample and record SHA-256. Put analysis outputs in a private /workspace/reverse-analysis directory, not alongside originals.
- Check analyzeHeadless -help for supported syntax. Typical static import:
  /opt/ghidra/support/analyzeHeadless /workspace/reverse-analysis my_project -import /workspace/sample.bin -analysisTimeoutPerFile 300
- Use only export scripts installed and reviewed on disk; do not invent ExportAll.java or other helpers.
- Cross-check decompiled pseudocode with addresses, disassembly and cross references. Decompiled C is not identical to original source.
- Keep tool versions, binary hash, program addresses, source evidence and limitations in the notebook.
- Never run the target or scripts embedded within the target without separate approval and sandboxing.

Curated for DSH with reference to the Trail of Bits ghidra-headless skill at https://github.com/trailofbits/skills-curated/tree/main/plugins/ghidra-headless. This independently authored skill does not copy its executable helper scripts.
