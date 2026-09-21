# DSH Research Project Instructions

## DSH-native Research tools

- When model-visible `research_project`, `research_data`, `research_pipeline`, or `research_results` tools are available, prefer them over constructing `research-*` shell commands.
- Treat the `research-*` CLI as the stable backend/diagnostic interface for CI, automation, Dashboard, and recovery — not as the normal user interface.
- Do not ask the user to memorize or type low-level Research CLI arguments unless they explicitly want command-line instructions or you are diagnosing the adapter itself.
- Before executing a pipeline, inspect status/explain first. The native pipeline tool defaults to dry-run; perform a real run only when the user's intent supports execution.
- Explain Research tool results in research terms (design, data lineage, stale/current results, reproducibility), not as raw JSON dumps unless the user asks for them.

You are working inside a reproducible research project. Optimize for traceability, evidence quality, and reproducibility rather than for producing a polished answer as quickly as possible.

## Research workflow

- Read `research.yaml` before making substantive research decisions.
- Keep the chain `literature -> question -> data -> analysis -> results -> paper` explicit.
- Distinguish evidence, interpretation, assumptions, and speculation.
- Do not invent citations, DOI values, datasets, variables, sample sizes, coefficients, p-values, or robustness results.
- When evidence is incomplete or conflicting, state the uncertainty instead of silently resolving it.

## Literature

- Prefer `research-literature add <DOI|arXiv|PDF>` to register papers instead of inventing metadata by hand.
- For a local PDF, use `research-literature extract <citation_key>` when page-aware text would make claims easier to verify.
- Maintain `literature/evidence-matrix.csv` for papers that materially support the project.
- Record at least the paper identity, research question, data, method, key finding, limitation, and relevance.
- Put BibTeX entries in `literature/references.bib`; keep structured paper notes under `literature/notes/`.
- Run `research-literature verify` before finalizing a literature review or paper.
- A literature summary should be traceable to specific papers; do not treat model-generated prose as evidence.

## Data

- Treat `data/raw/` as immutable source material. Never overwrite, normalize, clean, or recode files in place there.
- Write transformed analysis data to `data/processed/`.
- Do not publish or archive raw data unless its license, consent, and confidentiality constraints permit redistribution.
- Preserve missing-value rules, exclusions, joins, recodes, units, and sample filters in code or documented metadata.

## Analysis

- Use `notebooks/` for exploration and `src/` for analysis that must be rerunnable.
- Prefer deterministic scripts for paper-producing tables and figures.
- Set and record random seeds when randomness affects outputs.
- Write generated artifacts under `results/`; do not hand-edit generated tables or figures to change substantive results.
- For a result intended for the paper, prefer running it through `research-run --name <label> -- <command>` so the command, environment, Git state, hashes, stdout, and stderr are captured.
- Never report a numerical result as computed unless the relevant code actually ran successfully.

## Statistical and causal claims

- Separate descriptive association, prediction, and causal identification.
- State the estimand, sample/population, unit of observation, outcome, treatment/exposure, controls, and uncertainty measure when they matter.
- For causal designs, make identifying assumptions and major threats explicit.
- Do not choose specifications only because they improve significance or match a preferred conclusion.
- Report failed robustness checks and materially contradictory evidence.

## Writing

- The paper source is `paper/paper.qmd`; bibliography is `literature/references.bib`.
- Prefer tables and figures generated from code over copied values.
- Keep claims proportional to the design and evidence.
- Before finalizing a paper, check that cited sources exist, tables/figures can be regenerated, and reported numbers agree with generated outputs.

## Reproducibility and handoff

- Keep the project runnable from a clean Research Edition environment where feasible.
- Do not commit secrets, credentials, private tokens, or confidential raw data.
- Use `research-archive` for a handoff snapshot. It excludes `data/raw/` by default; include raw data only when redistribution is explicitly appropriate.
- If reproduction requires external/private data, document exactly what must be restored and where.
