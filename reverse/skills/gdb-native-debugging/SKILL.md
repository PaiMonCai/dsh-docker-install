---
name: gdb-native-debugging
description: Reconstruct authorized native program state with GDB, core dumps, register and stack evidence, and bounded dynamic experiments in an isolated environment.
---
# Native Debugging & Crash Forensics

Use for crash root cause analysis, control-flow questions that static decompilation cannot resolve, ABI/calling convention checks, and native program state reconstruction. The reverse image provides `gdb`, `gdb-multiarch`, `file`, `readelf`, `objdump`, and `strace`. A pwndbg extension is **not** assumed installed.

## Entry checks

1. Verify the executable and crash dump belong to the user or are authorized targets. Confirm architecture with `file` and `readelf -h` (ELF only), and hash original artifacts with `sha256sum`.
2. Prefer **offline core analysis** before launching a process: `gdb -q /workspace/target /workspace/core`. Run `info files`, `info threads`, `thread apply all bt`, `info registers`, `x/16gx $sp`, and `disassemble /r` as applicable.
3. Use `info sharedlibrary`, `maintenance info sections`, maps, stack frames and symbols to distinguish library/runtime failures from program bugs. Cross-reference disassembly with Ghidra or verified REA evidence by module offset, not invented symbols.

## Controlled execution (separate approval required)

Only if core/static artifacts are insufficient, ask before executing an unknown binary or attaching to a process. Use a disposable VM/container with minimal privileges, no secrets and preferably no network. Set resource/time limits externally; Docker itself is not a hostile-code security boundary. Attach only to a process you own or are authorized to investigate. Keep observations bounded and avoid altering target instructions by default.

- Prefer breakpoints at specific named functions/addresses relevant to the user question; collect backtraces, register values and memory ranges only as necessary.
- `strace -f -o /workspace/reverse-analysis/syscalls.log` can capture syscall behavior in a permitted experiment. Treat logs as sensitive; they may contain user paths, personal data or tokens.
- On ABI questions, compare observed register/stack arguments with platform conventions, and distinguish compiler optimization artifacts from actual source constructs.

## Evidence and stop rules

Record the binary/core hashes, architecture, command, thread/frame, instruction addresses, observation time, and limitations with `reverse_evidence_add`. Stop when the next experiment would require privileged tracing, unknown code execution without approval, secrets collection, or a larger containment boundary. Do not interpret an `info registers` snapshot as proof of the entire program behavior.
