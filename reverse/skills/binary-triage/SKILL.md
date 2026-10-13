---
name: binary-triage
description: Classify authorized ELF, PE, Mach-O and firmware binaries using static header, import, string and hash inspection before deeper analysis.
---
# Binary Triage
1. Confirm authority to inspect the artifact; never execute the target as a triage shortcut.
2. Record original file path, size and SHA-256 using sha256sum. Keep source bytes unchanged. Work on a copy if extraction is necessary.
3. Use file, xxd -l 256, and bounded strings -a -n 6 to identify characteristics, then readelf -h -l -S -d for ELF or objdump -p when applicable. PE/Mach-O data may require Ghidra/REA rather than ELF tools.
4. Identify format, architecture, bitness, potential packing, linkage and imported libraries, but distinguish header facts from behavioral inference.
5. If functions or data flow must be inspected, use Ghidra Headless or a verified REA MCP tool. Never guess a tool name or install dependencies silently.
6. Save relevant locations and evidence with reverse_evidence_add. Prefer static work; executing unknown binaries needs explicit authorization and disposable isolation.
