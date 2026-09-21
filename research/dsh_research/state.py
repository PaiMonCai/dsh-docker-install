"""Derived, read-only Research Project state."""

from __future__ import annotations

import csv
import os
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .config import load_research_config
from .datasets import verify_catalog
from .manifests import read_jsonl
from .project import ResearchProject
from .schema import infer_template, validate_project_schema
from .vcs import git_state

_BIB_KEY_RE = re.compile(r"@\w+\s*\{\s*([^,\s]+)\s*,", re.I)


def _count_files(path: Path, *, ignore_names: set[str] | None = None) -> int:
    if not path.is_dir():
        return 0
    ignore = ignore_names or set()
    return sum(
        1 for item in path.rglob("*")
        if item.is_file() and item.name not in ignore
    )


def _csv_rows(path: Path) -> int:
    if not path.is_file():
        return 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        return sum(1 for _ in csv.DictReader(handle))


def _jsonl_rows(path: Path) -> int:
    if not path.is_file() or path.stat().st_size == 0:
        return 0
    return len(read_jsonl(path))


def _glob_count(root: Path, pattern: str) -> int:
    return sum(1 for path in root.glob(pattern) if path.is_file())


@dataclass(frozen=True, slots=True)
class ProjectState:
    state_schema: int
    project: dict[str, Any]
    design: dict[str, Any]
    literature: dict[str, Any]
    data: dict[str, Any]
    runs: dict[str, Any]
    results: dict[str, Any]
    paper: dict[str, Any]
    release: dict[str, Any]
    git: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_project_state(project: ResearchProject) -> ProjectState:
    """Build ProjectState entirely from project files; no state database is used."""

    root = project.root
    config = load_research_config(project)
    schema = validate_project_schema(config)
    project_cfg = config.get("project") if isinstance(config.get("project"), dict) else {}
    research_cfg = config.get("research") if isinstance(config.get("research"), dict) else {}
    economics = config.get("economics") if isinstance(config.get("economics"), dict) else {}

    question = str(research_cfg.get("question") or "").strip()
    hypotheses = research_cfg.get("hypotheses")
    hypothesis_count = len(hypotheses) if isinstance(hypotheses, list) else 0

    econ_fields = (
        "population",
        "unit_of_observation",
        "outcome",
        "estimand",
        "identification_strategy",
    )
    econ_present = {field: bool(str(economics.get(field) or "").strip()) for field in econ_fields}

    literature = root / "literature"
    bib_path = literature / "references.bib"
    bib_text = bib_path.read_text(encoding="utf-8", errors="ignore") if bib_path.is_file() else ""

    raw_path = Path(str((config.get("data_policy") or {}).get("raw_path", "data/raw")))
    processed_path = Path(str((config.get("data_policy") or {}).get("processed_path", "data/processed")))
    if not raw_path.is_absolute():
        raw_path = root / raw_path
    if not processed_path.is_absolute():
        processed_path = root / processed_path

    runs_root = root / str((config.get("reproducibility") or {}).get("runs_path", "runs"))
    run_count = 0
    failed_runs = 0
    if runs_root.is_dir():
        for child in runs_root.iterdir():
            if not child.is_dir() or child.is_symlink():
                continue
            metadata = child / "metadata.json"
            if metadata.is_file():
                run_count += 1
                try:
                    import json
                    payload = json.loads(metadata.read_text(encoding="utf-8"))
                    if payload.get("exit_code") not in (None, 0):
                        failed_runs += 1
                except Exception:
                    failed_runs += 1

    paper_cfg = config.get("paper") if isinstance(config.get("paper"), dict) else {}
    paper_source = root / str(paper_cfg.get("source", "paper/paper.qmd"))
    bibliography = root / str(paper_cfg.get("bibliography", "literature/references.bib"))

    dataset_statuses = verify_catalog(project)
    dataset_counts = {
        key: sum(1 for item in dataset_statuses if item.status == key)
        for key in ("current", "stale", "missing", "invalid")
    }

    vcs = git_state(root).as_dict()
    return ProjectState(
        state_schema=1,
        project={
            "root": str(root),
            "slug": str(project_cfg.get("slug") or root.name),
            "title": str(project_cfg.get("title") or root.name),
            "config_schema": schema,
            "template": str(project_cfg.get("template") or infer_template(config)),
            "status": str(project_cfg.get("status") or "active"),
            "research_pack": os.environ.get("DSH_RESEARCH_PACK", "none"),
        },
        design={
            "field": str(research_cfg.get("field") or ""),
            "question_defined": bool(question),
            "hypotheses": hypothesis_count,
            "economics": econ_present if economics else None,
        },
        literature={
            "sources": _jsonl_rows(literature / "sources.jsonl"),
            "bibliography_entries": len(set(_BIB_KEY_RE.findall(bib_text))),
            "evidence_rows": _csv_rows(literature / "evidence-matrix.csv"),
            "notes": _count_files(literature / "notes"),
            "local_pdfs": _count_files(literature / "pdfs"),
        },
        data={
            "catalog_available": (root / "data" / "catalog").is_dir(),
            "registered_datasets": len(dataset_statuses),
            "current": dataset_counts["current"],
            "stale": dataset_counts["stale"],
            "missing": dataset_counts["missing"],
            "invalid": dataset_counts["invalid"],
            "raw_files": _count_files(raw_path, ignore_names={"README.md"}),
            "processed_files": _count_files(processed_path, ignore_names={"README.md"}),
        },
        runs={
            "total": run_count,
            "failed": failed_runs,
        },
        results={
            "models": _glob_count(root / "results" / "models", "*/model.json"),
            "comparisons": _glob_count(root / "results" / "comparisons", "*/comparison.json"),
            "did": _glob_count(root / "results" / "did", "*/did.json"),
            "tables": _count_files(root / "results" / "tables", ignore_names={"README.md"}),
            "figures": _count_files(root / "results" / "figures", ignore_names={"README.md"}),
        },
        paper={
            "source": str(paper_source.relative_to(root)) if paper_source.is_relative_to(root) else str(paper_source),
            "source_exists": paper_source.is_file(),
            "bibliography_exists": bibliography.is_file(),
            "pdf_exists": any((root / "paper").glob("*.pdf")) if (root / "paper").is_dir() else False,
            "html_exists": any((root / "paper").glob("*.html")) if (root / "paper").is_dir() else False,
        },
        release={
            "implemented": False,
            "directory_exists": (root / "release").is_dir(),
            "status": "not-ready",
        },
        git=vcs,
    )


def render_project_state(state: ProjectState) -> str:
    d = state.as_dict()
    git = d["git"]
    git_text = "unavailable"
    if git.get("available"):
        git_text = "dirty" if git.get("dirty") else "clean"

    lines = [
        "DSH Research Project",
        "────────────────────────────────",
        "",
        "Project",
        f"  Title                  {d['project']['title']}",
        f"  Template               {d['project']['template']}",
        f"  Schema                 {d['project']['config_schema']}",
        f"  Status                 {d['project']['status']}",
        f"  Git                    {git_text}",
        f"  Research Pack          {d['project']['research_pack']}",
        "",
        "Research Design",
        f"  Question               {'✓' if d['design']['question_defined'] else '—'}",
        f"  Hypotheses             {d['design']['hypotheses']}",
    ]

    econ = d["design"].get("economics")
    if isinstance(econ, dict):
        labels = {
            "population": "Population",
            "unit_of_observation": "Unit of observation",
            "outcome": "Outcome",
            "estimand": "Estimand",
            "identification_strategy": "Identification",
        }
        for key, label in labels.items():
            lines.append(f"  {label:22} {'✓' if econ.get(key) else '—'}")

    lines += [
        "",
        "Literature",
        f"  Sources                {d['literature']['sources']}",
        f"  Bibliography entries   {d['literature']['bibliography_entries']}",
        f"  Evidence rows          {d['literature']['evidence_rows']}",
        f"  Notes                  {d['literature']['notes']}",
        "",
        "Data",
        f"  Registered datasets    {d['data']['registered_datasets']}",
        f"  Current                {d['data']['current']}",
        f"  Stale                  {d['data']['stale']}",
        f"  Missing                {d['data']['missing']}",
        f"  Invalid                {d['data']['invalid']}",
        f"  Raw files              {d['data']['raw_files']}",
        f"  Processed files        {d['data']['processed_files']}",
        "",
        "Runs",
        f"  Total                  {d['runs']['total']}",
        f"  Failed                 {d['runs']['failed']}",
        "",
        "Results",
        f"  Models                 {d['results']['models']}",
        f"  Comparisons            {d['results']['comparisons']}",
        f"  DiD                    {d['results']['did']}",
        f"  Tables                 {d['results']['tables']}",
        f"  Figures                {d['results']['figures']}",
        "",
        "Paper",
        f"  Source                 {'✓' if d['paper']['source_exists'] else '—'}",
        f"  PDF                    {'✓' if d['paper']['pdf_exists'] else '—'}",
        f"  HTML                   {'✓' if d['paper']['html_exists'] else '—'}",
        "",
        "Release",
        f"  Status                 {d['release']['status'].upper()}",
    ]
    return "\n".join(lines)
