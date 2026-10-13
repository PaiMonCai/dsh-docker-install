---
name: android-apk-analysis
description: Inspect authorized Android APK/DEX statically using JADX, apktool and discovered REA MCP tools, mapping manifest and Java/smali classes.
---
# Android APK / DEX Static Analysis
1. Confirm authorized artifact. Record APK hash and preserve original bytes.
2. Choose unique private output directories in /workspace/reverse-analysis. Read jadx --help and apktool --help before using flags.
3. Typical read-only inputs: jadx -d /workspace/reverse-analysis/jadx-output /workspace/sample.apk; apktool d -o /workspace/reverse-analysis/resources /workspace/sample.apk.
4. Review decoded AndroidManifest, exported activities/services/receivers, permissions, intent filters, DEX class entrypoints and relevant resources.
5. Trace only classes/methods related to the user question. Compare JADX's Java-like reconstruction with smali when compiler transformations or obfuscation cause ambiguity.
6. If REA exposes Android tools, first verify the real MCP tool list and invoke relevant read-only tools. REA installed does not guarantee device providers.
7. Record hashes, component names, class/method identifiers and observations separately from hypotheses; do not disclose embedded credentials in reports.
Do not install or run the APK, attach Frida or connect a device without authorization and an isolated environment.
