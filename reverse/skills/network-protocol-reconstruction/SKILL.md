---
name: network-protocol-reconstruction
description: Infer authorized application protocols and request-response state machines from local HAR, browser logs or permitted captures without active probing of unknown hosts.
---
# Network Protocol & State Machine Reconstruction

Use when understanding an authorized application's browser requests, IPC-over-HTTP, WebSocket messages, API schemas or request/response timing, with existing HAR/JSON/PCAP files. This Skill is **offline first**. Neither Wireshark/tshark nor tcpdump is guaranteed to be installed.

## Collect safely

1. Establish the allowed system boundaries and whether the user supplied a capture or approved a test endpoint. Prefer an already recorded HAR or sanitized network log. Do not probe production services, enumerate undocumented endpoints, bypass rate limits or capture third-party traffic without explicit scope.
2. Record SHA-256, capture source, time range, redaction method, whether TLS was decrypted and whether payloads were truncated. HAR files may contain cookies, bearer tokens and personal data; redact before analysis and do not copy them into reports.
3. Use a read-only JSON parser or standard Python on a **copy** of HAR data. For PCAP, verify whether a suitable parser is already installed before promising decode; use protocol header metadata only if payload decryption is unavailable.

## High-value analysis

- Group exchanges by origin, method, path template, status code and message type. Identify session transitions, correlation IDs, retries, ordering guarantees, pagination, streaming and timeout behavior.
- Construct a table of observed input fields, output fields, content types, validation failures and evidence references. A single example does not prove a field is mandatory or optional.
- Reconstruct a protocol state machine as observed states and transitions, explicitly recording unknown branches and concurrent message races. Distinguish server-caused behavior from browser/client caching, proxies and instrumentation effects.
- Cross-correlate observed requests with JavaScript/Electron call sites and handlers, using precise timestamps, function paths and references from separate Skills.

## Validation and safety

Prefer **passive** replay against local fixtures with mock responses. Live calls to a user-approved service require new explicit approval, bounded request volumes and rate-limit respect; never submit credentials discovered in captures. Record conclusions through `reverse_evidence_add`, with redacted examples, known observations, competing explanations and reproducibility limits.
