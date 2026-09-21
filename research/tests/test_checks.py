from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from dsh_research.checks import run_checks
from dsh_research.config import write_yaml
from dsh_research.hashing import sha256_file
from dsh_research.project import ResearchProject


def make_project(root: Path, *, economics: bool = False) -> None:
    config = {
        "schema": 2,
        "project": {
            "slug": "demo",
            "title": "Demo",
            "template": "economics" if economics else "default",
            "status": "active",
        },
        "research": {
            "field": "economics" if economics else "",
            "question": "Does X affect Y?",
            "hypotheses": [],
        },
        "data_policy": {"raw_is_immutable": True, "raw_path": "data/raw", "processed_path": "data/processed"},
        "paper": {"source": "paper/paper.qmd", "bibliography": "literature/references.bib"},
    }
    if economics:
        config["economics"] = {
            "population": "firms",
            "unit_of_observation": "firm-year",
            "outcome": "y",
            "estimand": "ATT",
            "identification_strategy": "DiD",
        }
    write_yaml(root / "research.yaml", config)
    (root / "literature" / "notes").mkdir(parents=True)
    (root / "literature" / "references.bib").write_text("", encoding="utf-8")
    (root / "literature" / "sources.jsonl").write_text("", encoding="utf-8")
    (root / "literature" / "evidence-matrix.csv").write_text("citation_key\n", encoding="utf-8")
    (root / "data" / "raw").mkdir(parents=True)
    (root / "data" / "processed").mkdir(parents=True)
    (root / "paper").mkdir()
    (root / "paper" / "paper.qmd").write_text("# Paper\n", encoding="utf-8")


class CheckEngineTests(unittest.TestCase):
    def test_valid_minimal_project_has_no_errors(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            report = run_checks(ResearchProject(root), "full")
            self.assertTrue(report.ok)
            self.assertEqual(report.error_count, 0)

    def test_missing_question_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            cfg = json.loads(json.dumps({
                "schema": 2,
                "project": {"slug": "x", "title": "X", "template": "default", "status": "active"},
                "research": {"field": "", "question": "", "hypotheses": []},
                "data_policy": {"raw_is_immutable": True},
            }))
            write_yaml(root / "research.yaml", cfg)
            report = run_checks(ResearchProject(root), "quick")
            ids = {r.id for r in report.results if r.status == "fail"}
            self.assertIn("project.question", ids)
            self.assertFalse(report.ok)

    def test_economics_design_fields_are_required(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root, economics=True)
            cfg = {
                "schema": 2,
                "project": {"slug": "x", "title": "X", "template": "economics", "status": "active"},
                "research": {"field": "economics", "question": "Q?", "hypotheses": []},
                "economics": {"population": "firms"},
                "data_policy": {"raw_is_immutable": True},
            }
            write_yaml(root / "research.yaml", cfg)
            report = run_checks(ResearchProject(root), "quick")
            failed = {r.id for r in report.results if r.status == "fail"}
            self.assertIn("economics.estimand", failed)
            self.assertIn("economics.identification_strategy", failed)

    def test_missing_paper_citation_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            (root / "paper" / "paper.qmd").write_text("See @missing2026.\n", encoding="utf-8")
            report = run_checks(ResearchProject(root), "full")
            result = next(r for r in report.results if r.id == "paper.citations")
            self.assertEqual(result.status, "fail")
            self.assertEqual(result.severity, "ERROR")

    def test_quarto_crossrefs_are_not_bibliography_citations(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            (root / "paper" / "paper.qmd").write_text(
                "See @tbl-econ-baseline and @fig-did-main-event.\n",
                encoding="utf-8",
            )
            report = run_checks(ResearchProject(root), "full")
            citations = next(r for r in report.results if r.id == "paper.citations")
            self.assertEqual(citations.status, "pass")
            self.assertTrue(report.ok)

    def test_source_without_evidence_is_warning_not_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            (root / "literature" / "references.bib").write_text("@article{a, title={A}}\n", encoding="utf-8")
            (root / "literature" / "sources.jsonl").write_text(json.dumps({"citation_key": "a"}) + "\n", encoding="utf-8")
            report = run_checks(ResearchProject(root), "full")
            coverage = next(r for r in report.results if r.id == "literature.coverage")
            self.assertEqual(coverage.severity, "WARN")
            self.assertTrue(report.ok)

    def test_tracked_raw_data_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            (root / "data" / "raw" / "secret.csv").write_text("x\n1\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "add", "data/raw/secret.csv"], check=True)
            report = run_checks(ResearchProject(root), "quick")
            raw = next(r for r in report.results if r.id == "data.raw.git-tracking")
            self.assertEqual(raw.status, "fail")
            self.assertEqual(raw.severity, "ERROR")

    def test_model_input_hash_change_is_error(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            data_path = root / "data" / "processed" / "analysis.csv"
            data_path.write_text("y\n1\n", encoding="utf-8")
            out = root / "results" / "tables" / "m.csv"
            out.parent.mkdir(parents=True)
            out.write_text("term,estimate\nx,1\n", encoding="utf-8")
            manifest_dir = root / "results" / "models" / "m"
            manifest_dir.mkdir(parents=True)
            manifest = {
                "name": "m",
                "data": {"path": "data/processed/analysis.csv", "sha256": sha256_file(data_path)},
                "outputs": {"table_csv": {"path": "results/tables/m.csv", "sha256": sha256_file(out)}},
            }
            (manifest_dir / "model.json").write_text(json.dumps(manifest), encoding="utf-8")
            data_path.write_text("y\n2\n", encoding="utf-8")
            report = run_checks(ResearchProject(root), "full")
            model = next(r for r in report.results if r.id == "result.model.m")
            self.assertEqual(model.status, "fail")
            self.assertEqual(model.severity, "ERROR")

    def test_release_requires_clean_git_and_rendered_paper(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            report = run_checks(ResearchProject(root), "release")
            failed = {r.id for r in report.results if r.status == "fail"}
            self.assertIn("release.git", failed)
            self.assertIn("release.paper", failed)


if __name__ == "__main__":
    unittest.main()
