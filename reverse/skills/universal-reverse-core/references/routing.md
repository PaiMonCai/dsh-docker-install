# Cross-platform classification and routing

Start with the bytes, execution environment and observed question, not a guessed file extension. Always run reverse-triage first when given a supported local file under /workspace; report unknown formats as unknown.

| Target signal | Likely layers | First existing tool/skill | Unverified until |
| --- | --- | --- | --- |
| ELF, shared object, Linux executable | dynamic loader, native functions, syscalls, external services | binary-triage, ghidra-headless, gdb-native-debugging | ABI, loader/runtime and needed libraries checked |
| MZ/PE Windows executable or DLL | PE imports, Windows APIs, managed or native runtime | binary-triage, ghidra-headless | format validated beyond MZ signature |
| Mach-O | native/ObjC/Swift, OS frameworks | binary-triage and relevant REA tools if present | supported Mach-O tool capabilities verified |
| ZIP with AndroidManifest.xml / DEX | Android, Java/Dex, native, hybrid runtime, server | binary-triage, verified JADX/Apktool tools | manifest and actual runtime owner confirmed |
| ASAR/Electron / JS project | Electron main/renderer, IPC, native addons, remote APIs | electron-javascript-analysis, javascript-deobfuscation | entrypoint and process boundary confirmed |
| HAR, PCAP, web app | browser, backend, HTTP/WS and auth/session state | network-protocol-reconstruction | capture origin, truncation, encryption and redaction known |
| Firmware archive/image | container FS, bootloader, architecture, OS services | firmware-static-analysis | format, unpacking method and target architecture confirmed |
| WebAssembly magic | WASM module, host imports, runtime boundary | binary-triage; inspect module tools only if available | parser and host binding capabilities checked |
| Ambiguous / packed / mixed | first distinguish wrapper, payload and executing runtime | binary-triage; narrow format-specific recon | reliable positive probe and owner found |

## Owning-layer questions

1. What produces the observable behavior and who has final authority?
2. Is the path local code, embedded runtime, OS dependency, client/server protocol, or authoritative backend?
3. Is the observed path reached by the test? Which input reproduces it?
4. Does a referenced string or dead code prove an active path? (No.)
5. What evidence would disprove this ownership guess? Run the smallest safe probe.

Choose an index/reference search before bulk decompilation where possible. For split runtimes, record each hand-off instead of treating only the outer container as the whole program. A failure to decode is an instrument limitation until proven otherwise.
