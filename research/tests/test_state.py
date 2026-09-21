from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from dsh_research.config import load_yaml, write_yaml
from dsh_research.project import ResearchProject
from dsh_research.schema import infer_template, migrate_config, migrate_project
from dsh_research.state import build_project_state


class SchemaTests(unittest.TestCase):
    def test_migration_is_additive_and_preserves_v1_fields(self) -> None:
        source = {
            "schema": 1,
            "project": {"slug": "thesis", "title": "Thesis"},
            "research": {"field": "economics", "question": "Q?", "hypotheses": ["H1"]},
            "economics": {"estimand": "ATT"},
            "paper": {"source": "paper/paper.qmd"},
        }
        migrated = migrate_config(source, 2)
        self.assertEqual(source["schema"], 1)
        self.assertEqual(migrated["schema"], 2)
        self.assertEqual(migrated["research"], source["research"])
        self.assertEqual(migrated["economics"], source["economics"])
        self.assertEqual(migrated["project"]["template"], "economics")
        self.assertEqual(migrated["project"]["status"], "active")

    def test_migrate_project_creates_backup(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            original = {"schema": 1, "project": {"slug": "x", "title": "X"}}
            write_yaml(root / "research.yaml", original)
            before, after, backup = migrate_project(ResearchProject(root), target=2)
            self.assertEqual((before, after), (1, 2))
            self.assertIsNotNone(backup)
            assert backup is not None
            self.assertEqual(load_yaml(backup), original)
            self.assertEqual(load_yaml(root / "research.yaml")["schema"], 2)

    def test_template_inference(self) -> None:
        self.assertEqual(infer_template({"schema": 1, "economics": {}}), "economics")
        self.assertEqual(infer_template({"schema": 1, "research": {"field": ""}}), "default")

    def test_migration_is_idempotent(self) -> None:
        current = {
            "schema": 2,
            "project": {"slug": "x", "title": "X", "template": "default", "status": "active"},
        }
        self.assertEqual(migrate_config(current, 2), current)


class ProjectStateTests(unittest.TestCase):
    def test_state_reads_schema1_without_migration(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            write_yaml(
                root / "research.yaml",
                {
                    "schema": 1,
                    "project": {"slug": "legacy", "title": "Legacy"},
                    "research": {"field": "", "question": "", "hypotheses": []},
                },
            )
            state = build_project_state(ResearchProject(root))
            self.assertEqual(state.project["config_schema"], 1)
            self.assertEqual(state.project["template"], "default")
            self.assertEqual(load_yaml(root / "research.yaml")["schema"], 1)

    def test_state_aggregates_existing_v1_objects(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            write_yaml(
                root / "research.yaml",
                {
                    "schema": 2,
                    "project": {"slug": "demo", "title": "Demo", "template": "economics", "status": "active"},
                    "research": {"field": "economics", "question": "Effect?", "hypotheses": ["H1"]},
                    "economics": {
                        "population": "firms",
                        "unit_of_observation": "firm-year",
                        "outcome": "y",
                        "estimand": "ATT",
                        "identification_strategy": "DiD",
                    },
                    "data_policy": {"raw_path": "data/raw", "processed_path": "data/processed"},
                    "reproducibility": {"runs_path": "runs"},
                    "paper": {"source": "paper/paper.qmd", "bibliography": "literature/references.bib"},
                },
            )
            (root / "literature" / "notes").mkdir(parents=True)
            (root / "literature" / "sources.jsonl").write_text(
                json.dumps({"citation_key": "a"}) + "\n" + json.dumps({"citation_key": "b"}) + "\n",
                encoding="utf-8",
            )
            (root / "literature" / "references.bib").write_text(
                "@article{a, title={A}}\n@article{b, title={B}}\n", encoding="utf-8"
            )
            (root / "literature" / "evidence-matrix.csv").write_text(
                "citation_key,title\na,A\n", encoding="utf-8"
            )
            (root / "literature" / "notes" / "a.md").write_text("# A\n", encoding="utf-8")
            (root / "data" / "raw").mkdir(parents=True)
            (root / "data" / "raw" / "README.md").write_text("policy", encoding="utf-8")
            (root / "data" / "raw" / "source.csv").write_text("x\n1\n", encoding="utf-8")
            (root / "data" / "processed").mkdir(parents=True)
            (root / "data" / "processed" / "panel.csv").write_text("x\n1\n", encoding="utf-8")
            (root / "runs" / "r1").mkdir(parents=True)
            (root / "runs" / "r1" / "metadata.json").write_text('{"exit_code": 0}\n', encoding="utf-8")
            (root / "results" / "models" / "m1").mkdir(parents=True)
            (root / "results" / "models" / "m1" / "model.json").write_text("{}\n", encoding="utf-8")
            (root / "results" / "did" / "d1").mkdir(parents=True)
            (root / "results" / "did" / "d1" / "did.json").write_text("{}\n", encoding="utf-8")
            (root / "paper").mkdir()
            (root / "paper" / "paper.qmd").write_text("# Paper\n", encoding="utf-8")

            subprocess.run(["git", "init", "-q", str(root)], check=True)
            state = build_project_state(ResearchProject(root))
            self.assertEqual(state.project["config_schema"], 2)
            self.assertTrue(state.design["question_defined"])
            self.assertEqual(state.literature["sources"], 2)
            self.assertEqual(state.literature["evidence_rows"], 1)
            self.assertEqual(state.data["raw_files"], 1)
            self.assertEqual(state.data["processed_files"], 1)
            self.assertEqual(state.runs["total"], 1)
            self.assertEqual(state.results["models"], 1)
            self.assertEqual(state.results["did"], 1)
            self.assertTrue(state.paper["source_exists"])


if __name__ == "__main__":
    unittest.main()
