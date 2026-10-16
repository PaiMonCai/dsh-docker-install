# Cross-platform symptom router

Use this when a result contradicts the current explanation; consult the listed specialized Skill before attempting the next route.

| Symptom | First check | Route |
| --- | --- | --- |
| Decompiled source has no function or only stubs | parser coverage, packer/encryption, alternate runtime | binary-triage / ghidra-headless |
| Binary starts but behavior never appears | input path, dependency and client/server authority | native/JS skill and network-protocol-reconstruction |
| A string or API name exists but hook never triggers | dead code, alternate process, late-loaded module, probe health | frida-runtime-instrumentation |
| Modification builds but crashes | zero-change control, ABI, dynamic library load, structural diff | ghidra-headless / gdb-native-debugging |
| No log or trace events | positive-control instrumentation and alternate logging channel | frida-runtime-instrumentation |
| A protocol field seems absent | capture truncation, TLS encryption, compression and alternate message type | network-protocol-reconstruction |
| New version differs at nearly every function address | rebasing/relocation before semantic comparison | ghidra-headless / reverse-diff |
| Tool missing or appears unsupported | exact executable/runtime probe, then capability registry | reverse-doctor --json |
| Commands run successfully but question remains unanswered | return to G1 and define the behavioral acceptance check | verification.md |
| Nothing matches a known branch | record unknown, choose a cheap discriminating read-only experiment | routing.md |

Never automatically apply APK-specific patches or bypass logic to unrelated executables. An unexplained symptom is a reason to ask a narrower question, not to grant more permissions.
