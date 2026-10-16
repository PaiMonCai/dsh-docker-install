# Investigation gates

These are measurable decisions, not a checklist of tool names.

## G1: authorized target and testable output
Record the allowed artifact/environment and goal. Define deliverable form (report, protocol model, source mapping, tested local change) and limits (OS, ABI, network, privileges, persistence). If target authorization or execution scope is unclear, remain read-only and ask before active operations.

## G2: capability truth
Use "reverse-doctor --json". Record which required routes are available/partial/blocked. Its executable-path checks prove presence only, not working devices, licenses, ABI support, debugger attachment or successful analysis. Do not silently install a missing tool. If a capability is absent, state an installation/request decision rather than changing the scientific question.

## G3: code and authority location
Identify the owner of the behavior from at least one observed reference, trace, protocol transition or component boundary. If unresolved, record competing hypotheses and the cheapest discriminating experiment. Do not edit an unlocated layer.

## G4: baseline and controls
Record input and derived artifact hashes, environment and observed original behavior. For any modification, generate and verify a zero-change artifact using the same path. If the control fails, debug the environment/toolchain before attributing failure to the change. Static-only investigations require original hashes and a reproducible inspection, but do not claim dynamic controls were run.

## Stop and return to classification
- Two equivalent attempts fail to provide the predicted signal.
- A new observation contradicts a previously settled conclusion.
- An instrumentation probe and its positive control are both silent.
- The target appears absent only in a format the tool cannot parse.
- Scope, device, runtime, license, or isolation needed for the next experiment is not authorized.
- A test succeeds in a different deployment environment than the stated deliverable.

A blocked gate does not erase existing valid evidence. Report the boundary and the next actionable, permitted check.
