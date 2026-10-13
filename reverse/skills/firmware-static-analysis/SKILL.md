---
name: firmware-static-analysis
description: Perform authorized offline embedded firmware triage, segment mapping, architecture clues, compressed filesystem assessment and Ghidra-assisted call-path investigation.
---
# Firmware & Embedded Image Static Analysis

Use for authorized device firmware, BIOS-like images and opaque embedded update packages where native desktop executable assumptions do not hold. The image includes `file`, `xxd`, `strings`, `binutils`, `readelf` and Ghidra. Tools such as `binwalk`, QEMU system emulators and vendor decryptors are **not** guaranteed installed.

## Stage 1: provenance and layout

1. Verify right to inspect the image and record device model, vendor publication or acquisition source when known. Compute SHA-256 and retain the original immutable. Check `file`, a bounded `xxd -l 512` view, entropy indicators from a read-only byte histogram, and bounded strings.
2. Sketch the image map: header, manifest, partition descriptors, architecture hints, checksums, compression signatures, candidate bootloader/kernel/filesystems. Keep every claimed offset/length tied to inspected bytes; signatures can produce false positives.
3. Parse only formats understood by trusted tools already in the container. For unknown encrypted or signed containers, do not guess keys, bypass signatures or assert extraction is complete.

## Stage 2: bounded extraction on copies

- If decompression is appropriate and authorized, use standard tools on a new private output path with bounds on decompressed size, file count, nesting depth and disk usage. Avoid traversing symlinks, absolute paths, archive path traversal, device nodes and scripts in extracted images.
- Check image/segment hashes after extraction; identify byte order and endianness. Separate actual filesystem files from orphan strings or carved fragments.
- Document any uncertainty about CPU variant, memory map or loader relocation before assigning Ghidra processor/segment base.

## Stage 3: program behavior and evidence

- Use Ghidra Headless only on known binary segments; specify architecture manually only when supported by evidence. Focus on boot sequence, configuration handlers, update validation, persistence and hardware interfaces relevant to the user's question.
- Build a module/segment map with exact addresses and offsets, showing what was directly observed and what was inferred. Avoid claiming that disassembly of data regions proves executable code.
- Do not flash devices, run firmware, connect to an exposed service, or change device state without explicit authorization and a separate disposable hardware/emulation environment.

Save stage transitions and segment-level evidence with reverse notebook tools. If a step lacks a trustworthy extraction or base-address assumption, stop and ask for the missing metadata rather than manufacturing conclusions.
