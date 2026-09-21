from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dsh_research.config import write_yaml
from dsh_research.results import (
    ResultError,
    load_result_manifest,
    register_result,
    result_status,
    result_type_counts,
    sync_legacy_results,
    verify_registry,
)
from dsh_research.project import ResearchProject


class ResultRegistryTests(unittest.TestCase):
    def make_project(self, root: Path) -> ResearchProject:
        write_yaml(
            root / "research.yaml",
            {
                "schema": 2,
                "project": {
                    "slug": "result-test",
                    "title": "Result Test",
                    "template": "default",
                    "status": "active",
                },
            },
        )
        return ResearchProject(root.resolve())

    def test_register_and_verify_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            artifact = root / "results" / "tables" / "summary.csv"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("x\n1\n", encoding="utf-8")

            register_result(
                project,
                result_id="summary",
                result_type="table",
                title="Summary",
                artifacts=["results/tables/summary.csv"],
            )
            status = result_status(project, "summary")
            self.assertEqual(status.status, "current")
            self.assertEqual(status.artifacts, 1)
            self.assertTrue(status.hash)

            artifact.write_text("x\n2\n", encoding="utf-8")
            status = result_status(project, "summary")
            self.assertEqual(status.status, "stale")
            self.assertIn("artifact SHA256 changed", status.message)

    def test_source_manifest_and_run_are_tracked(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            source = root / "results" / "models" / "m" / "model.json"
            source.parent.mkdir(parents=True)
            source.write_text('{"name":"m"}\n', encoding="utf-8")
            run_dir = root / "runs" / "run-1"
            run_dir.mkdir(parents=True)
            (run_dir / "metadata.json").write_text(
                json.dumps({"schema": 2, "kind": "research-run", "id": "run-1", "success": True}),
                encoding="utf-8",
            )

            register_result(
                project,
                result_id="model-m",
                result_type="model",
                source_manifest="results/models/m/model.json",
                run_id="run-1",
            )
            self.assertEqual(result_status(project, "model-m").status, "current")

            source.write_text('{"name":"m","changed":true}\n', encoding="utf-8")
            status = result_status(project, "model-m")
            self.assertEqual(status.status, "stale")
            self.assertIn("source manifest SHA256 changed", status.message)

    def test_dataset_change_marks_result_stale(self) -> None:
        from dsh_research.datasets import register_dataset

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            data = root / "data" / "processed" / "panel.csv"
            data.parent.mkdir(parents=True)
            data.write_text("id,y\n1,2\n", encoding="utf-8")
            register_dataset(project, dataset_id="panel", path=data, kind="processed")

            artifact = root / "results" / "tables" / "main.csv"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("b\n1\n", encoding="utf-8")
            register_result(
                project,
                result_id="main",
                result_type="model",
                input_datasets=["panel"],
                artifacts=[artifact],
            )

            data.write_text("id,y\n1,9\n", encoding="utf-8")
            register_dataset(
                project,
                dataset_id="panel",
                path=data,
                kind="processed",
                force=True,
            )
            status = result_status(project, "main")
            self.assertEqual(status.status, "stale")
            self.assertIn("input dataset SHA256 changed", status.message)

    def test_missing_artifact_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            artifact = root / "results" / "figures" / "plot.png"
            artifact.parent.mkdir(parents=True)
            artifact.write_bytes(b"png")
            register_result(
                project,
                result_id="plot",
                result_type="figure",
                artifacts=[artifact],
            )
            artifact.unlink()
            self.assertEqual(result_status(project, "plot").status, "missing")

    def test_duplicate_requires_force(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            artifact = root / "results" / "tables" / "x.csv"
            artifact.parent.mkdir(parents=True)
            artifact.write_text("x\n", encoding="utf-8")
            register_result(project, result_id="x", result_type="table", artifacts=[artifact])
            with self.assertRaises(ResultError):
                register_result(project, result_id="x", result_type="table", artifacts=[artifact])
            first = load_result_manifest(project, "x")["created_at"]
            artifact.write_text("x\n1\n", encoding="utf-8")
            register_result(
                project,
                result_id="x",
                result_type="table",
                artifacts=[artifact],
                force=True,
            )
            second = load_result_manifest(project, "x")
            self.assertEqual(second["created_at"], first)
            self.assertEqual(result_status(project, "x").status, "current")

    def test_sync_existing_economics_results(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            model_dir = root / "results" / "models" / "baseline"
            table_dir = root / "results" / "tables"
            did_dir = root / "results" / "did" / "policy"
            model_dir.mkdir(parents=True)
            table_dir.mkdir(parents=True)
            did_dir.mkdir(parents=True)
            data = root / "data" / "processed" / "panel.csv"
            data.parent.mkdir(parents=True)
            data.write_text("id,y\n1,2\n", encoding="utf-8")
            model_table = table_dir / "baseline.csv"
            model_table.write_text("term,b\nx,1\n", encoding="utf-8")
            did_table = did_dir / "estimates.csv"
            did_table.write_text("event_time,estimate\n0,1\n", encoding="utf-8")

            import hashlib
            sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            (model_dir / "model.json").write_text(
                json.dumps({
                    "schema": 1,
                    "kind": "economics-model",
                    "name": "baseline",
                    "title": "Baseline",
                    "data": {"path": "data/processed/panel.csv", "sha256": sha(data)},
                    "outputs": {
                        "table_csv": {"path": "results/tables/baseline.csv", "sha256": sha(model_table)}
                    },
                }),
                encoding="utf-8",
            )
            (did_dir / "did.json").write_text(
                json.dumps({
                    "schema": 1,
                    "kind": "did-event-study",
                    "name": "policy",
                    "title": "Policy DiD",
                    "design": {"data": "data/processed/panel.csv", "data_sha256": sha(data)},
                    "outputs": {
                        "estimates": {"path": "results/did/policy/estimates.csv", "sha256": sha(did_table)}
                    },
                }),
                encoding="utf-8",
            )

            changes = sync_legacy_results(project)
            self.assertEqual(
                sorted(item["id"] for item in changes),
                ["did-policy", "model-baseline"],
            )
            statuses = verify_registry(project)
            self.assertTrue(all(item.status == "current" for item in statuses))
            self.assertEqual(
                result_type_counts(statuses),
                {"did": 1, "model": 1},
            )


if __name__ == "__main__":
    unittest.main()
