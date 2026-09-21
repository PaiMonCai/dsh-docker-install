from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from dsh_research.config import write_yaml


RESEARCH_ROOT = Path(__file__).resolve().parents[1]
BIN = RESEARCH_ROOT / "bin"


def make_project(root: Path) -> None:
    write_yaml(
        root / "research.yaml",
        {
            "schema": 2,
            "project": {
                "slug": "json-contract",
                "title": "JSON Contract",
                "template": "default",
                "status": "active",
            },
            "research": {
                "field": "",
                "question": "Does X affect Y?",
                "hypotheses": [],
            },
            "data_policy": {
                "raw_is_immutable": True,
                "raw_path": "data/raw",
                "processed_path": "data/processed",
            },
            "paper": {
                "source": "paper/paper.qmd",
                "bibliography": "literature/references.bib",
            },
        },
    )
    (root / "data" / "raw").mkdir(parents=True)
    (root / "data" / "processed").mkdir(parents=True)
    (root / "results" / "registry").mkdir(parents=True)
    (root / "paper").mkdir()
    (root / "paper" / "paper.qmd").write_text("# Paper\n", encoding="utf-8")
    (root / "literature").mkdir()
    (root / "literature" / "references.bib").write_text("", encoding="utf-8")
    (root / "literature" / "sources.jsonl").write_text("", encoding="utf-8")
    (root / "literature" / "evidence-matrix.csv").write_text(
        "citation_key\n", encoding="utf-8"
    )
    write_yaml(root / "pipeline.yaml", {"schema": 1, "steps": {}})


def run_cli(root: Path, script: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(RESEARCH_ROOT)
    return subprocess.run(
        [sys.executable, str(BIN / script), *args],
        cwd=root,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


class JsonCliContractTests(unittest.TestCase):
    def assert_envelope(
        self,
        result: subprocess.CompletedProcess[str],
        *,
        command: str,
        operation: str,
        ok: bool,
    ) -> dict:
        payload = json.loads(result.stdout)
        self.assertEqual(
            list(payload.keys()),
            ["api", "command", "operation", "ok", "data", "error"],
        )
        self.assertEqual(payload["api"], {"name": "dsh-research", "version": 1})
        self.assertEqual(payload["command"], command)
        self.assertEqual(payload["operation"], operation)
        self.assertEqual(payload["ok"], ok)
        self.assertEqual(payload["error"] is None, ok)
        return payload

    def test_core_cli_success_envelopes(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)

            cases = [
                ("research-status", ("--json",), "status"),
                ("research-check", ("--quick", "--json"), "quick"),
                ("research-data", ("list", "--json"), "list"),
                ("research-pipeline", ("status", "--json"), "status"),
                ("research-result", ("list", "--json"), "list"),
            ]
            for script, args, operation in cases:
                with self.subTest(script=script):
                    result = run_cli(root, script, *args)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, "")
                    self.assert_envelope(
                        result,
                        command=script,
                        operation=operation,
                        ok=True,
                    )

    def test_project_error_is_json_and_exit_2(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            result = run_cli(root, "research-status", "--json")
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stderr, "")
            payload = self.assert_envelope(
                result,
                command="research-status",
                operation="status",
                ok=False,
            )
            self.assertEqual(payload["error"]["code"], "RESEARCH_ERROR")

    def test_research_run_json_suppresses_child_streams(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            result = run_cli(
                root,
                "research-run",
                "--json",
                "--name",
                "noise",
                "--",
                sys.executable,
                "-c",
                "import sys; print('STDOUT-NOISE'); print('STDERR-NOISE', file=sys.stderr)",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = self.assert_envelope(
                result,
                command="research-run",
                operation="run",
                ok=True,
            )
            self.assertNotIn("STDOUT-NOISE", result.stdout)
            self.assertEqual(result.stderr, "")
            run_dir = root / payload["data"]["run_dir"]
            self.assertIn(
                "STDOUT-NOISE",
                (run_dir / "stdout.log").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "STDERR-NOISE",
                (run_dir / "stderr.log").read_text(encoding="utf-8"),
            )

    def test_research_run_command_failure_uses_exit_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            make_project(root)
            result = run_cli(
                root,
                "research-run",
                "--json",
                "--",
                sys.executable,
                "-c",
                "import sys; sys.exit(9)",
            )
            self.assertEqual(result.returncode, 1)
            payload = self.assert_envelope(
                result,
                command="research-run",
                operation="run",
                ok=False,
            )
            self.assertEqual(payload["error"]["code"], "RUN_COMMAND_FAILED")
            self.assertEqual(payload["data"]["command_exit_code"], 9)


if __name__ == "__main__":
    unittest.main()
