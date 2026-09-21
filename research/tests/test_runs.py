from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from dsh_research.project import ResearchProject
from dsh_research.runs import record_run


class RunManifestTests(unittest.TestCase):
    def make_project(self, root: Path) -> ResearchProject:
        (root / "research.yaml").write_text(
            "schema: 2\nproject:\n  slug: run-test\n  title: Run Test\n  template: default\n  status: active\n",
            encoding="utf-8",
        )
        (root / "data" / "raw").mkdir(parents=True)
        (root / "data" / "processed").mkdir(parents=True)
        return ResearchProject(root.resolve())

    def test_schema2_success_and_compatibility_files(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            result = record_run(
                project,
                label="baseline",
                command=[
                    "python",
                    "-c",
                    "from pathlib import Path; Path('result.txt').write_text('ok')",
                ],
                output_files=["result.txt"],
            )
            manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema"], 2)
            self.assertEqual(manifest["kind"], "research-run")
            self.assertTrue(manifest["success"])
            self.assertEqual(manifest["exit_code"], 0)
            self.assertEqual(manifest["outputs"]["files"][0]["status"], "current")
            self.assertTrue((result.run_dir / "command.sh").is_file())
            self.assertTrue((result.run_dir / "stdout.log").is_file())
            self.assertTrue((result.run_dir / "stderr.log").is_file())
            self.assertTrue((root / "runs" / "latest").is_symlink())

    def test_failed_command_is_still_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            result = record_run(
                project,
                label="fail",
                command=["python", "-c", "import sys; sys.exit(9)"],
            )
            manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(result.exit_code, 9)
            self.assertFalse(manifest["success"])
            self.assertEqual(manifest["exit_code"], 9)

    def test_missing_explicit_input_is_recorded_not_hidden(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            project = self.make_project(root)
            result = record_run(
                project,
                label="missing-input",
                command=["python", "-c", "print('ok')"],
                input_files=["data/raw/missing.csv"],
            )
            manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["inputs"]["files"][0]["status"], "missing")


if __name__ == "__main__":
    unittest.main()
