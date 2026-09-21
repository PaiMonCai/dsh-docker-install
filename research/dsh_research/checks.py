"""Rule engine for validating Research Projects."""

from __future__ import annotations

import csv
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .config import load_research_config
from .hashing import sha256_file
from .manifests import read_jsonl
from .project import ResearchProject
from .schema import CURRENT_PROJECT_SCHEMA, infer_template, validate_project_schema
from .vcs import git_state

_BIB_KEY_RE = re.compile(r"@\w+\s*\{\s*([^,\s]+)\s*,", re.I)
_PAPER_CITE_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.:+-]+)")
_QUARTO_CROSSREF_PREFIXES = (
    "fig-", "tbl-", "eq-", "sec-", "lst-",
    "thm-", "lem-", "cor-", "prp-", "cnj-", "def-", "exm-", "exr-",
)


@dataclass(frozen=True, slots=True)
class CheckResult:
    id: str
    severity: str
    status: str
    message: str
    path: str | None = None
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class CheckReport:
    mode: str
    results: tuple[CheckResult, ...]

    @property
    def error_count(self) -> int:
        return sum(1 for r in self.results if r.status == "fail" and r.severity == "ERROR")

    @property
    def warning_count(self) -> int:
        return sum(1 for r in self.results if r.status == "fail" and r.severity == "WARN")

    @property
    def skipped_count(self) -> int:
        return sum(1 for r in self.results if r.status == "skip")

    @property
    def ok(self) -> bool:
        return self.error_count == 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "check_schema": 1,
            "mode": self.mode,
            "ok": self.ok,
            "summary": {
                "errors": self.error_count,
                "warnings": self.warning_count,
                "skipped": self.skipped_count,
                "total": len(self.results),
            },
            "results": [r.as_dict() for r in self.results],
        }


def _pass(check_id: str, message: str, *, severity: str = "INFO", path: str | None = None) -> CheckResult:
    return CheckResult(check_id, severity, "pass", message, path)


def _fail(
    check_id: str,
    severity: str,
    message: str,
    *,
    path: str | None = None,
    details: dict[str, Any] | None = None,
) -> CheckResult:
    return CheckResult(check_id, severity, "fail", message, path, details)


def _skip(check_id: str, message: str, *, severity: str = "WARN", path: str | None = None) -> CheckResult:
    return CheckResult(check_id, severity, "skip", message, path)


def _bib_keys(path: Path) -> tuple[list[str], set[str]]:
    if not path.is_file():
        return [], set()
    text = path.read_text(encoding="utf-8", errors="ignore")
    keys = _BIB_KEY_RE.findall(text)
    return keys, set(keys)


def _evidence_keys(path: Path) -> tuple[list[str], set[str]]:
    if not path.is_file():
        return [], set()
    values: list[str] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            values.append(str(row.get("citation_key") or "").strip())
    return values, {value for value in values if value}


def _source_keys(path: Path) -> list[str]:
    if not path.is_file() or path.stat().st_size == 0:
        return []
    return [str(row.get("citation_key") or "").strip() for row in read_jsonl(path)]


def _paper_citations(root: Path) -> set[str]:
    cited: set[str] = set()
    paper = root / "paper"
    if not paper.is_dir():
        return cited
    for qmd in paper.rglob("*.qmd"):
        candidates = _PAPER_CITE_RE.findall(qmd.read_text(encoding="utf-8", errors="ignore"))
        cited.update(
            key for key in candidates
            if not key.lower().startswith(_QUARTO_CROSSREF_PREFIXES)
        )
    return cited


def _raw_tracking_check(root: Path, raw_path: Path) -> CheckResult:
    vcs = git_state(root)
    if not vcs.available:
        return _skip("data.raw.git-tracking", "Git unavailable; raw-data tracking check skipped.")

    try:
        relative = raw_path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return _skip(
            "data.raw.git-tracking",
            "raw_path is outside the project; Git tracking check skipped.",
            path=str(raw_path),
        )

    try:
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "--", relative],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return _skip("data.raw.git-tracking", "Unable to execute Git.")

    tracked = [
        item for item in result.stdout.splitlines()
        if item and not item.endswith("/README.md") and item != f"{relative}/README.md"
    ]
    if tracked:
        return _fail(
            "data.raw.git-tracking",
            "ERROR",
            f"{len(tracked)} raw-data file(s) are tracked by Git.",
            path=relative,
            details={"files": tracked},
        )
    return _pass("data.raw.git-tracking", "Raw data is not tracked by Git.", path=relative)


def _verify_artifact(
    root: Path,
    *,
    check_id: str,
    item: dict[str, Any] | None,
    label: str,
) -> CheckResult | None:
    if not item:
        return None
    path_value = str(item.get("path") or "")
    expected = str(item.get("sha256") or "")
    if not path_value:
        return _fail(check_id, "ERROR", f"{label}: missing output path")
    path = root / path_value
    if not path.is_file():
        return _fail(check_id, "ERROR", f"{label}: output missing", path=path_value)
    if expected and sha256_file(path) != expected:
        return _fail(check_id, "ERROR", f"{label}: output SHA256 changed", path=path_value)
    return None


def _check_model_manifest(root: Path, manifest_path: Path) -> list[CheckResult]:
    rel = manifest_path.relative_to(root).as_posix()
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [_fail("result.model.manifest", "ERROR", f"Invalid model manifest: {exc}", path=rel)]

    name = str(data.get("name") or manifest_path.parent.name)
    check_id = f"result.model.{name}"
    data_meta = data.get("data") if isinstance(data.get("data"), dict) else {}
    data_path_value = str(data_meta.get("path") or "")
    expected = str(data_meta.get("sha256") or "")
    if not data_path_value:
        return [_fail(check_id, "ERROR", "Model manifest is missing data.path.", path=rel)]

    data_path = root / data_path_value
    if not data_path.is_file():
        return [_fail(check_id, "ERROR", "Model input data is missing.", path=data_path_value)]
    if expected and sha256_file(data_path) != expected:
        return [_fail(check_id, "ERROR", "Model input data SHA256 changed.", path=data_path_value)]

    outputs = data.get("outputs") if isinstance(data.get("outputs"), dict) else {}
    failures = [
        result
        for key, item in outputs.items()
        if isinstance(item, dict)
        for result in [_verify_artifact(root, check_id=check_id, item=item, label=key)]
        if result is not None
    ]
    if failures:
        return failures
    return [_pass(check_id, "Model inputs and outputs match the manifest.", path=rel)]


def _check_did_manifest(root: Path, manifest_path: Path) -> list[CheckResult]:
    rel = manifest_path.relative_to(root).as_posix()
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [_fail("result.did.manifest", "ERROR", f"Invalid DiD manifest: {exc}", path=rel)]

    name = str(data.get("name") or manifest_path.parent.name)
    check_id = f"result.did.{name}"
    design = data.get("design") if isinstance(data.get("design"), dict) else {}
    data_path_value = str(design.get("data") or "")
    expected = str(design.get("data_sha256") or "")
    if not data_path_value:
        return [_fail(check_id, "ERROR", "DiD manifest is missing design.data.", path=rel)]

    data_path = root / data_path_value
    if not data_path.is_file():
        return [_fail(check_id, "ERROR", "DiD input data is missing.", path=data_path_value)]
    if expected and sha256_file(data_path) != expected:
        return [_fail(check_id, "ERROR", "DiD input data SHA256 changed.", path=data_path_value)]

    outputs = data.get("outputs") if isinstance(data.get("outputs"), dict) else {}
    failures = [
        result
        for key, item in outputs.items()
        if isinstance(item, dict)
        for result in [_verify_artifact(root, check_id=check_id, item=item, label=key)]
        if result is not None
    ]
    if failures:
        return failures

    results = [_pass(check_id, "DiD inputs and outputs match the manifest.", path=rel)]
    warnings = data.get("warnings")
    if isinstance(warnings, list) and warnings:
        results.append(
            _fail(
                f"{check_id}.diagnostics",
                "WARN",
                f"DiD manifest contains {len(warnings)} diagnostic warning(s).",
                path=rel,
                details={"warnings": warnings},
            )
        )
    return results


def run_checks(project: ResearchProject, mode: str = "full") -> CheckReport:
    if mode not in {"quick", "full", "release"}:
        raise ValueError(f"unknown check mode: {mode}")

    root = project.root
    cfg = load_research_config(project)
    schema = validate_project_schema(cfg)
    project_cfg = cfg.get("project") if isinstance(cfg.get("project"), dict) else {}
    research = cfg.get("research") if isinstance(cfg.get("research"), dict) else {}
    template = str(project_cfg.get("template") or infer_template(cfg))
    results: list[CheckResult] = []

    if schema == CURRENT_PROJECT_SCHEMA:
        results.append(_pass("project.schema", f"Project schema is current ({schema}).", path="research.yaml"))
    else:
        severity = "ERROR" if mode == "release" else "WARN"
        results.append(
            _fail(
                "project.schema",
                severity,
                f"Project schema {schema} can be migrated to {CURRENT_PROJECT_SCHEMA}.",
                path="research.yaml",
            )
        )

    question = str(research.get("question") or "").strip()
    if question:
        results.append(_pass("project.question", "Research question is defined.", path="research.yaml"))
    else:
        results.append(_fail("project.question", "ERROR", "Research question is empty.", path="research.yaml"))

    if template == "economics" or isinstance(cfg.get("economics"), dict):
        econ = cfg.get("economics") if isinstance(cfg.get("economics"), dict) else {}
        required = {
            "population": "Population",
            "unit_of_observation": "Unit of observation",
            "outcome": "Outcome",
            "estimand": "Estimand",
            "identification_strategy": "Identification strategy",
        }
        for key, label in required.items():
            if str(econ.get(key) or "").strip():
                results.append(_pass(f"economics.{key}", f"{label} is defined.", path="research.yaml"))
            else:
                results.append(_fail(f"economics.{key}", "ERROR", f"{label} is empty.", path="research.yaml"))

    data_policy = cfg.get("data_policy") if isinstance(cfg.get("data_policy"), dict) else {}
    if data_policy.get("raw_is_immutable") is True:
        results.append(_pass("data.raw.immutable", "Raw-data immutability policy is enabled.", path="research.yaml"))
    else:
        results.append(
            _fail(
                "data.raw.immutable",
                "ERROR",
                "data_policy.raw_is_immutable must be true.",
                path="research.yaml",
            )
        )

    raw_path = Path(str(data_policy.get("raw_path") or "data/raw"))
    if not raw_path.is_absolute():
        raw_path = root / raw_path
    results.append(_raw_tracking_check(root, raw_path))

    if mode == "quick":
        return CheckReport(mode, tuple(results))

    literature = root / "literature"
    bib_path = literature / "references.bib"
    bib_list, bib_set = _bib_keys(bib_path)
    if not bib_path.is_file():
        results.append(_fail("literature.bibliography", "ERROR", "references.bib is missing.", path="literature/references.bib"))
    elif len(bib_list) != len(bib_set):
        results.append(_fail("literature.bibliography", "ERROR", "references.bib contains duplicate citation keys.", path="literature/references.bib"))
    else:
        results.append(_pass("literature.bibliography", f"Bibliography contains {len(bib_set)} unique entries.", path="literature/references.bib"))

    source_path = literature / "sources.jsonl"
    source_keys = _source_keys(source_path)
    missing_source_bib = sorted({key for key in source_keys if key and key not in bib_set})
    if missing_source_bib:
        results.append(
            _fail(
                "literature.sources",
                "ERROR",
                f"{len(missing_source_bib)} source(s) are missing from references.bib.",
                path="literature/sources.jsonl",
                details={"citation_keys": missing_source_bib},
            )
        )
    else:
        results.append(_pass("literature.sources", f"{len(source_keys)} registered source(s) are consistent with the bibliography.", path="literature/sources.jsonl"))

    evidence_path = literature / "evidence-matrix.csv"
    evidence_list, evidence_set = _evidence_keys(evidence_path)
    evidence_errors = []
    if "" in evidence_list:
        evidence_errors.append("empty citation_key")
    duplicates = sorted({key for key in evidence_list if key and evidence_list.count(key) > 1})
    if duplicates:
        evidence_errors.append("duplicate citation_key: " + ", ".join(duplicates))
    missing_evidence_bib = sorted(evidence_set - bib_set)
    if missing_evidence_bib:
        evidence_errors.append("not in bibliography: " + ", ".join(missing_evidence_bib))
    if evidence_errors:
        results.append(
            _fail(
                "literature.evidence",
                "ERROR",
                "; ".join(evidence_errors),
                path="literature/evidence-matrix.csv",
            )
        )
    else:
        results.append(_pass("literature.evidence", f"Evidence Matrix contains {len(evidence_list)} row(s).", path="literature/evidence-matrix.csv"))

    source_set = {key for key in source_keys if key}
    uncovered = sorted(source_set - evidence_set)
    if uncovered:
        results.append(
            _fail(
                "literature.coverage",
                "WARN",
                f"{len(uncovered)} registered source(s) have no Evidence Matrix row.",
                path="literature/evidence-matrix.csv",
                details={"citation_keys": uncovered},
            )
        )
    else:
        results.append(_pass("literature.coverage", "All registered sources are represented in the Evidence Matrix."))

    missing_notes = sorted(key for key in evidence_set if not (literature / "notes" / f"{key}.md").is_file())
    if missing_notes:
        results.append(
            _fail(
                "literature.notes",
                "WARN",
                f"{len(missing_notes)} evidence source(s) have no structured note.",
                path="literature/notes",
                details={"citation_keys": missing_notes},
            )
        )
    else:
        results.append(_pass("literature.notes", "Structured notes exist for all evidence sources.", path="literature/notes"))

    cited = _paper_citations(root)
    missing_citations = sorted(cited - bib_set)
    if missing_citations:
        results.append(
            _fail(
                "paper.citations",
                "ERROR",
                f"{len(missing_citations)} paper citation(s) are missing from references.bib.",
                path="paper",
                details={"citation_keys": missing_citations},
            )
        )
    else:
        results.append(_pass("paper.citations", f"All {len(cited)} paper citation(s) resolve in the bibliography.", path="paper"))

    for manifest in sorted((root / "results" / "models").glob("*/model.json")):
        results.extend(_check_model_manifest(root, manifest))
    for manifest in sorted((root / "results" / "did").glob("*/did.json")):
        results.extend(_check_did_manifest(root, manifest))

    if mode == "release":
        vcs = git_state(root)
        if not vcs.available:
            results.append(_fail("release.git", "ERROR", "Git is required for release checks."))
        elif vcs.dirty:
            results.append(_fail("release.git", "ERROR", "Git working tree is dirty."))
        else:
            results.append(_pass("release.git", "Git working tree is clean."))

        paper_dir = root / "paper"
        rendered = list(paper_dir.glob("*.pdf")) + list(paper_dir.glob("*.html")) if paper_dir.is_dir() else []
        if rendered:
            results.append(_pass("release.paper", f"Found {len(rendered)} rendered paper artifact(s).", path="paper"))
        else:
            results.append(_fail("release.paper", "ERROR", "No rendered paper PDF/HTML found.", path="paper"))

    return CheckReport(mode, tuple(results))


def render_report(report: CheckReport) -> str:
    lines: list[str] = []
    labels = {"pass": "PASS", "fail": None, "skip": "SKIP"}
    for result in report.results:
        if result.status == "fail":
            prefix = result.severity
        else:
            prefix = labels[result.status] or result.severity
        suffix = f" ({result.path})" if result.path else ""
        lines.append(f"{prefix:5} {result.id}")
        lines.append(f"      {result.message}{suffix}")
    lines += [
        "",
        f"Summary: {report.error_count} error(s), {report.warning_count} warning(s), "
        f"{report.skipped_count} skipped, {len(report.results)} total",
    ]
    return "\n".join(lines)
