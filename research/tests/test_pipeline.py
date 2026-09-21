from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from dsh_research.config import write_yaml
from dsh_research.pipeline import (
    PipelineError,
    execute_pipeline,
    explain_step,
    load_pipeline,
    step_statuses,
    topological_order,
)
from dsh_research.project import ResearchProject


class PipelineTests(unittest.TestCase):
    def make_project(self, root: Path) -> ResearchProject:
        write_yaml(
            root / "research.yaml",
            {
                "schema": 2,
                "project": {
                    "slug": "pipeline-test",
                    "title": "Pipeline Test",
                    "template": "default",
                    "status": "active",
                },
                "research": {"field": "", "question": "Q?", "hypotheses": []},
            },
        )
        (root / "data").mkdir()
        (root / "src").mkdir()
        (root / "results").mkdir()
        (root / "paper").mkdir()
        return ResearchProject(root.resolve())

    def write_scripts(self, root: Path) -> None:
        (root / "src" / "clean.py").write_text(
            "from pathlib import Path\n"
            "raw = Path('data/raw.txt').read_text()\n"
            "Path('data/clean.txt').write_text(raw.upper())\n",
            encoding="utf-8",
        )
        (root / "src" / "model.py").write_text(
            "from pathlib import Path\n"
            "value = Path('data/clean.txt').read_text()\n"
            "Path('results/model.txt').write_text('MODEL:' + value)\n",
            encoding="utf-8",
        )
        (root / "src" / "paper.py").write_text(
            "from pathlib import Path\n"
            "value = Path('results/model.txt').read_text()\n"
            "Path('paper/out.txt').write_text('PAPER:' + value)\n",
            encoding="utf-8",
        )

    def write_pipeline(self, root: Path) -> None:
        write_yaml(
            root / "pipeline.yaml",
            {
                "schema": 1,
                "steps": {
                    "clean": {
                        "command": ["python", "src/clean.py"],
                        "inputs": {
                            "files": ["data/raw.txt", "src/clean.py"],
                        },
                        "outputs": {
                            "files": ["data/clean.txt"],
                        },
                    },
                    "model": {
                        "depends_on": ["clean"],
                        "command": ["python", "src/model.py"],
                        "inputs": {
                            "files": ["data/clean.txt", "src/model.py"],
                        },
                        "outputs": {
                            "files": ["results/model.txt"],
                        },
                    },
                    "paper": {
                        "depends_on": ["model"],
                        "command": ["python", "src/paper.py"],
                        "inputs": {
                            "files": ["results/model.txt", "src/paper.py"],
                        },
                        "outputs": {
                            "files": ["paper/out.txt"],
                        },
                    },
                },
            },
        )

    def actions(self, decisions):
        return [(item["step"], item["action"]) for item in decisions]

    def test_incremental_execution_and_stale_propagation(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            self.write_scripts(root)
            self.write_pipeline(root)
            (root / "data" / "raw.txt").write_text("one\n", encoding="utf-8")
            pipeline = load_pipeline(project)

            first = execute_pipeline(project, pipeline)
            self.assertEqual(
                self.actions(first),
                [("clean", "RUN"), ("model", "RUN"), ("paper", "RUN")],
            )
            self.assertTrue(all(x.status == "current" for x in step_statuses(project, pipeline).values()))

            second = execute_pipeline(project, pipeline)
            self.assertEqual(
                self.actions(second),
                [("clean", "SKIP"), ("model", "SKIP"), ("paper", "SKIP")],
            )

            (root / "data" / "raw.txt").write_text("two\n", encoding="utf-8")
            raw_change = execute_pipeline(project, pipeline)
            self.assertEqual(
                self.actions(raw_change),
                [("clean", "RUN"), ("model", "RUN"), ("paper", "RUN")],
            )

            (root / "src" / "model.py").write_text(
                "from pathlib import Path\n"
                "value = Path('data/clean.txt').read_text()\n"
                "Path('results/model.txt').write_text('MODEL-V2:' + value)\n",
                encoding="utf-8",
            )
            model_change = execute_pipeline(project, pipeline)
            self.assertEqual(
                self.actions(model_change),
                [("clean", "SKIP"), ("model", "RUN"), ("paper", "RUN")],
            )

            (root / "src" / "paper.py").write_text(
                "from pathlib import Path\n"
                "value = Path('results/model.txt').read_text()\n"
                "Path('paper/out.txt').write_text('PAPER-V2:' + value)\n",
                encoding="utf-8",
            )
            paper_change = execute_pipeline(project, pipeline)
            self.assertEqual(
                self.actions(paper_change),
                [("clean", "SKIP"), ("model", "SKIP"), ("paper", "RUN")],
            )

    def test_dry_run_plans_full_chain_before_outputs_exist(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            self.write_scripts(root)
            self.write_pipeline(root)
            (root / "data" / "raw.txt").write_text("one\n", encoding="utf-8")
            pipeline = load_pipeline(project)
            decisions = execute_pipeline(project, pipeline, dry_run=True)
            self.assertEqual(
                self.actions(decisions),
                [("clean", "RUN"), ("model", "RUN"), ("paper", "RUN")],
            )
            self.assertFalse((root / "data" / "clean.txt").exists())
            self.assertFalse((root / "results" / "model.txt").exists())
            self.assertFalse((root / "paper" / "out.txt").exists())

    def test_explain_reports_input_change(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            self.write_scripts(root)
            self.write_pipeline(root)
            (root / "data" / "raw.txt").write_text("one\n", encoding="utf-8")
            pipeline = load_pipeline(project)
            execute_pipeline(project, pipeline)

            (root / "data" / "raw.txt").write_text("changed\n", encoding="utf-8")
            status = explain_step(project, pipeline, "clean")
            self.assertEqual(status.status, "stale")
            self.assertIn("input fingerprint changed", status.reasons)

    def test_cycle_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            write_yaml(
                root / "pipeline.yaml",
                {
                    "schema": 1,
                    "steps": {
                        "a": {
                            "depends_on": ["b"],
                            "command": ["python", "-c", "print('a')"],
                            "outputs": {"files": ["a.txt"]},
                        },
                        "b": {
                            "depends_on": ["a"],
                            "command": ["python", "-c", "print('b')"],
                            "outputs": {"files": ["b.txt"]},
                        },
                    },
                },
            )
            with self.assertRaises(PipelineError):
                load_pipeline(project)

    def test_target_includes_dependencies_only(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            self.write_scripts(root)
            self.write_pipeline(root)
            pipeline = load_pipeline(project)
            self.assertEqual(topological_order(pipeline, ["model"]), ["clean", "model"])


if __name__ == "__main__":
    unittest.main()
