---
name: frida-runtime-instrumentation
description: Plan and review authorized dynamic observations using installed Frida CLI and Python bindings with narrowly scoped hooks, safe logging, and evidence provenance.
---
# Frida Runtime Instrumentation

Use only when a static question needs an authorized dynamic observation: argument/return shape, code path activation, object lifetime, or a comparison between expected and observed behavior. The image includes `frida-tools`, Frida Python bindings, and pwntools; it does **not** include a device-side Frida server, target application, simulator, or permission to attach to third-party processes.

## Capability check

1. Confirm ownership or explicit scope of authorization. Locate the exact local test binary/process and document host/device, OS, architecture and version. Use `frida --version` and `frida-ps --help` for local CLI checks; do not assume a remotely connected device or provider.
2. First state the hypothesis, the minimum required observation (one function, bounded arguments, or event count), and which result would falsify the hypothesis. Favor a locally built sample or disposable lab app.
3. Use the actual exposed REA/Frida tools if the MCP connection lists them; do not assume `mcp__rea__*` names or device access. A CLI existing on PATH does not prove that attach/instrument works.

## Experiment design

- Instrument the smallest possible allowlisted function set and bound the number of observations and duration. Avoid hooks that modify control flow, bypass checks, or capture unrelated content.
- Log minimal function metadata and sanitized argument types instead of memory dumps, raw credentials, payment details or full network payloads.
- Label observations by module/build hash, symbol/address, timestamp and test inputs. Compare multiple controlled runs before inferring invariants.
- Prefer detached inspection and cleanup after each run. Document which hooks can distort timings or behavior and whether the observation is repeatable.

## Consent and containment

Explicit permission is required before attaching, launching unknown executables, accessing external devices or initiating network requests. For untrusted binaries, prefer an offline disposable VM with dedicated privilege controls. Do not provide instructions for stealthy instrumentation, authentication bypass, evasion or secret collection. Use `reverse_evidence_add` to separate observed runtime evidence from causal inference, then create a reproducible report.
