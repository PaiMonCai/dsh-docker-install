# Common interpretation traps

The examples below are illustrative review patterns, not findings about a user's target.

## "The network call was removed"

A diff lists an edge in `edges_removed`. Before accepting removal, locate both input Ghidra exports and check their exported function sets and recorded target identity.

If the callee was not exported on the right, the edge can disappear solely because the graph only connects exported functions. The supported wording is "the edge is absent from the right export"; target behavior remains unresolved.

## "This Electron application has an exploitable IPC endpoint"

A JS triage record contains IPC-related signal matches. Inspect the matched source region when it is available, not just the count.

The signal alone does not establish that the code is reachable, exposed to an untrusted caller, missing validation, or executable in the deployed version. Separate discovery of a potential interface from a confirmed vulnerability and state which prerequisite is missing.

## "The updated sample is unchanged"

Two reports share a program filename, or a workspace index reports successful verification.

A filename does not identify bytes. An index verification checks indexed report files, not equivalence of target samples. If comparable target identities are absent, the defensible statement concerns the reports, not the binaries.

## "All functions were reviewed"

A Ghidra call graph has `truncated: false` and the task succeeded.

The flag applies to the bounded exported edge list. Function count and pseudocode length can still be capped, and unexported or indirect calls remain outside the report. Describe the reviewed subset instead.

## "The experiment proves the hypothesis"

A case marks a hypothesis `supported`, but the experiment has no observed result or cites an unrelated artifact.

Follow the actual IDs and recorded observations. Without a relevant control and a result that discriminates the proposed cause, present the conclusion as the author's assessment and identify the missing causal link.
