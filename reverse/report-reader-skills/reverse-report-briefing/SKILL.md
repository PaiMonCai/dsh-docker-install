---
name: reverse-report-briefing
description: Turn existing reverse-engineering findings into a concise technical or decision-focused briefing with traceable evidence and prioritized follow-up. Use when the reader needs implications and next decisions rather than raw analysis detail.
---
# Brief Findings for a Decision

Use the user's stated audience and decision. If neither is specified, produce an engineer-readable explanation and do not stall for a template choice.

## Select what changes a decision

For each candidate finding, identify:

- The question it answers and the operational implication.
- The source locator and whether it is observed data, a report author's assertion or your inference.
- The uncertainty that could change the recommended action.

Prefer a few consequential findings to a catalog of tools and functions. Explain necessary terms where they arise; do not replace precise function/address references with vague prose.

## Match the audience

| Audience | Emphasize |
| --- | --- |
| Engineer | Component ownership, call/data flow, relevant functions, conditions and implementation uncertainty. |
| Reviewer | Evidence support, contradictory records, missing coverage and which claims need sign-off. |
| Decision maker | Practical effect, alternatives, unresolved dependency and the next decision; keep technical locators accessible. |

Keep consequence distinct from likelihood. Do not convert a static marker into confirmed data exposure, assign a numerical risk score, invent effort estimates, or call behavior verified because the task exited zero.

## Recommend a useful next step

Rank follow-up by whether it can resolve an important uncertainty at reasonable stated effort. If effort is unknown, say so rather than estimating. State the question, the evidence gap, and the observation that would change the decision.

Make a recommendation conditional when it depends on unverified behavior. Escalate deeper analysis to the reverse-engineering Agent as a proposed task, not an executed action.

## Deliver progressively

Start with the answer and its implication, then a compact findings/evidence table and at most three next checks. Retain disagreements and important limits even when the user asks for a short answer.

Offer a focused call-chain, timeline or individual-report explanation only when useful. Return the briefing in the conversation; this Skill does not enable file writing, commands, task execution or external sharing.
