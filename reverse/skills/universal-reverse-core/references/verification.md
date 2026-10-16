# Evidence and verification protocol

For every important assertion record: sample SHA-256; tool and version when available; exact command or reproducible action; evidence locator (path, offset, symbol, function, event timestamp); observation; coverage; competing explanation; confidence class.

Classes:
- observed: reproduced with output, positive control where needed.
- inferred: deductive or interpretive conclusion from observed facts.
- unverified: plausible, not tested.
- unknown: probe missing, failed, timed out, or did not reach relevant layer.
- refuted: disproven with specific evidence, preserved so it is not retried.

Do not confuse negative finding with probe failure. A parser returning no functions on encrypted code is not evidence the program has no functions. Confirm probe health with known-good fixtures and state exact coverage.

## Universal claim ladder
0. sample identity and structure established
1. relevant code/data references identified
2. mechanism hypothesized with supporting evidence
3. mechanism reproduced with a control, if dynamic testing was authorized
4. requested artifact/change structurally validated (only if applicable)
5. target behavior verified in the intended environment
6. adjacent behaviors regression-checked
7. final distributed artifact hash matches the tested one

Not every analysis aims for 7; state the required level and actually reached level. A read-only report can be complete at an earlier level if its constrained deliverable was only a documented observation. No invented runtime results.

Retain the original sample. Work on copies for modification. One variable per experiment. Redact secrets, tokens, account data, private network traces and personal information. Cross-platform results must name OS/architecture/runtime, not just a file path.
