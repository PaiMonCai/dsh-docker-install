from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path


RESEARCH_ROOT = Path(__file__).resolve().parents[1]
BIN = RESEARCH_ROOT / "bin"


def env_for_source_tree() -> dict[str, str]:
    env = os.environ.copy()
    current = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(RESEARCH_ROOT) if not current else str(RESEARCH_ROOT) + os.pathsep + current
    return env


def run_cli(
    root: Path,
    script: str,
    *args: str,
    expected: int | None = 0,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [sys.executable, str(BIN / script), *args],
        cwd=root,
        env=env_for_source_tree(),
        check=False,
        capture_output=True,
        text=True,
    )
    if expected is not None and completed.returncode != expected:
        raise AssertionError(
            f"{script} {' '.join(args)} returned {completed.returncode}, expected {expected}\n"
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return completed


def json_cli(
    root: Path,
    script: str,
    *args: str,
    expected: int = 0,
) -> dict:
    completed = run_cli(root, script, *args, expected=expected)
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(
            f"{script} did not return JSON:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        ) from exc


def git(root: Path, *args: str) -> None:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise AssertionError(
            f"git {' '.join(args)} failed\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )


class V2ReleaseCandidateIntegrationTests(unittest.TestCase):
    maxDiff = None

    def make_schema1_project(self, root: Path) -> None:
        (root / "research.yaml").write_text(
            """schema: 1
project:
  slug: rc-project
  title: RC Project
research:
  field: general
  question: Does reproducible input X change output Y?
  hypotheses: []
data_policy:
  raw_is_immutable: true
  raw_path: data/raw
  processed_path: data/processed
paper:
  source: paper/paper.qmd
  bibliography: literature/references.bib
""",
            encoding="utf-8",
        )
        for path in [
            "data/raw",
            "data/processed",
            "data/catalog",
            "src",
            "results/tables",
            "results/registry",
            "literature/notes",
            "paper",
        ]:
            (root / path).mkdir(parents=True, exist_ok=True)

        (root / ".gitignore").write_text(
            "research.yaml.bak.schema*\n"
            "data/raw/*\n"
            "!data/raw/README.md\n",
            encoding="utf-8",
        )
        (root / "data/raw/source.csv").write_text(
            "id,x\n1,2\n2,4\n",
            encoding="utf-8",
        )
        (root / "literature/references.bib").write_text("", encoding="utf-8")
        (root / "literature/sources.jsonl").write_text("", encoding="utf-8")
        (root / "literature/evidence-matrix.csv").write_text(
            "citation_key\n",
            encoding="utf-8",
        )
        (root / "paper/paper.qmd").write_text(
            "# RC Paper\n\nReproducibility integration fixture.\n",
            encoding="utf-8",
        )
        (root / "src/clean.py").write_text(
            "from pathlib import Path\n"
            "src=Path('data/raw/source.csv').read_text()\n"
            "Path('data/processed/panel.csv').write_text(src.replace(',x', ',y'))\n",
            encoding="utf-8",
        )
        (root / "src/model.py").write_text(
            "from pathlib import Path\n"
            "rows=Path('data/processed/panel.csv').read_text().strip().splitlines()\n"
            "Path('results/tables/main.csv').write_text('metric,value\\nrows,'+str(len(rows)-1)+'\\n')\n",
            encoding="utf-8",
        )
        (root / "src/paper.py").write_text(
            "from pathlib import Path\n"
            "table=Path('results/tables/main.csv').read_text()\n"
            "Path('paper/paper.html').write_text('<html><body><pre>'+table+'</pre></body></html>')\n",
            encoding="utf-8",
        )
        (root / "pipeline.yaml").write_text(
            """schema: 1
steps:
  clean:
    command: [python, src/clean.py]
    inputs:
      datasets: [raw-source]
      files: [src/clean.py]
    outputs:
      files: [data/processed/panel.csv]
  model:
    depends_on: [clean]
    command: [python, src/model.py]
    inputs:
      files: [data/processed/panel.csv, src/model.py]
    outputs:
      files: [results/tables/main.csv]
  paper:
    depends_on: [model]
    command: [python, src/paper.py]
    inputs:
      files: [results/tables/main.csv, src/paper.py]
    outputs:
      files: [paper/paper.html]
""",
            encoding="utf-8",
        )

        git(root, "init", "-q")
        git(root, "config", "user.email", "rc@example.invalid")
        git(root, "config", "user.name", "DSH RC")

    def test_schema1_to_release_ready_then_stale_propagation(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            self.make_schema1_project(root)

            checked = run_cli(root, "research-migrate", "--check")
            self.assertIn("migration available: schema 1 -> 2", checked.stdout)

            migrated = run_cli(root, "research-migrate", "--to", "2")
            self.assertIn("migrated: 1 -> 2", migrated.stdout)
            backup = root / "research.yaml.bak.schema1"
            self.assertTrue(backup.is_file())
            self.assertIn("schema: 1", backup.read_text(encoding="utf-8"))

            second_migration = run_cli(root, "research-migrate", "--to", "2")
            self.assertIn("schema already 2", second_migration.stdout)
            self.assertEqual(backup.read_text(encoding="utf-8").count("schema: 1"), 1)

            raw = json_cli(
                root,
                "research-data",
                "register",
                "data/raw/source.csv",
                "--name",
                "raw-source",
                "--kind",
                "raw",
                "--json",
            )
            self.assertTrue(raw["ok"])
            self.assertEqual(raw["data"]["dataset"]["status"], "current")

            first_run = json_cli(root, "research-pipeline", "run", "--json")
            self.assertEqual(
                [(x["step"], x["action"]) for x in first_run["data"]["decisions"]],
                [("clean", "RUN"), ("model", "RUN"), ("paper", "RUN")],
            )
            second_run = json_cli(root, "research-pipeline", "run", "--json")
            self.assertEqual(
                [(x["step"], x["action"]) for x in second_run["data"]["decisions"]],
                [("clean", "SKIP"), ("model", "SKIP"), ("paper", "SKIP")],
            )

            panel = json_cli(
                root,
                "research-data",
                "register",
                "data/processed/panel.csv",
                "--name",
                "panel",
                "--kind",
                "processed",
                "--input",
                "raw-source",
                "--code",
                "src/clean.py",
                "--pipeline-step",
                "clean",
                "--json",
            )
            self.assertEqual(panel["data"]["dataset"]["status"], "current")

            recorded = json_cli(
                root,
                "research-run",
                "--json",
                "--name",
                "table-snapshot",
                "--input-dataset",
                "panel",
                "--input-file",
                "results/tables/main.csv",
                "--output-file",
                "results/tables/snapshot.txt",
                "--",
                sys.executable,
                "-c",
                (
                    "from pathlib import Path;"
                    "Path('results/tables/snapshot.txt').write_text("
                    "Path('results/tables/main.csv').read_text())"
                ),
            )
            run_id = recorded["data"]["run_id"]
            self.assertTrue(run_id)

            result = json_cli(
                root,
                "research-result",
                "register",
                "--id",
                "main-table",
                "--type",
                "table",
                "--title",
                "Main table",
                "--run",
                run_id,
                "--input-dataset",
                "panel",
                "--artifact",
                "results/tables/snapshot.txt",
                "--json",
            )
            self.assertEqual(result["data"]["result"]["status"], "current")

            status = json_cli(root, "research-status", "--json")
            self.assertEqual(status["data"]["project"]["config_schema"], 2)
            self.assertEqual(status["data"]["data"]["registered_datasets"], 2)
            self.assertEqual(status["data"]["pipeline"]["steps"], 3)
            self.assertEqual(status["data"]["pipeline"]["stale"], 0)
            self.assertEqual(status["data"]["results"]["registered"], 1)
            self.assertEqual(status["data"]["results"]["current"], 1)

            # Commit every reproducibility artifact except ignored raw data so
            # the release gate can verify a clean repository.
            git(root, "add", "-A")
            git(root, "commit", "-qm", "RC fixture ready")

            release = json_cli(
                root,
                "research-check",
                "--release",
                "--json",
            )
            self.assertTrue(release["ok"])
            gate = release["data"]["release_gate"]
            self.assertEqual(gate["policy_version"], 1)
            self.assertTrue(gate["ready"])
            self.assertEqual(gate["blocking_errors"], 0)

            # Exercise Dashboard through the actual CLI process, not internal
            # Python objects, then query its Stable JSON API bridge.
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-u",
                    str(BIN / "research-dashboard"),
                    "--project",
                    str(root),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "0",
                    "--quiet",
                ],
                cwd=root,
                env=env_for_source_tree(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            try:
                url = None
                deadline = time.time() + 8
                assert process.stdout is not None
                while time.time() < deadline:
                    line = process.stdout.readline().strip()
                    if line.startswith("URL:"):
                        url = line.split("URL:", 1)[1].strip()
                        break
                    if process.poll() is not None:
                        break
                self.assertIsNotNone(
                    url,
                    "dashboard did not publish its URL before the startup deadline",
                )
                with urllib.request.urlopen(str(url) + "api/status", timeout=5) as response:
                    dashboard_status = json.loads(response.read().decode("utf-8"))
                self.assertEqual(dashboard_status["api"], {"name": "dsh-research", "version": 1})
                self.assertEqual(dashboard_status["data"]["project"]["slug"], "rc-project")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)

            # Remote exposure must stay opt-in.
            remote = run_cli(
                root,
                "research-dashboard",
                "--project",
                str(root),
                "--host",
                "0.0.0.0",
                "--port",
                "0",
                expected=2,
            )
            self.assertIn("--allow-remote", remote.stderr)

            # Change raw data and refresh only its catalog fingerprint. The
            # processed dataset should become stale through lineage, then the
            # Pipeline and Result Registry must propagate that staleness.
            (root / "data/raw/source.csv").write_text(
                "id,x\n1,20\n2,40\n",
                encoding="utf-8",
            )
            json_cli(
                root,
                "research-data",
                "register",
                "data/raw/source.csv",
                "--name",
                "raw-source",
                "--kind",
                "raw",
                "--force",
                "--json",
            )

            verify_data = json_cli(
                root,
                "research-data",
                "verify",
                "--json",
                expected=1,
            )
            statuses = {
                item["dataset_id"]: item["status"]
                for item in verify_data["data"]["datasets"]
            }
            self.assertEqual(statuses["raw-source"], "current")
            self.assertEqual(statuses["panel"], "stale")

            pipeline_status = json_cli(root, "research-pipeline", "status", "--json")
            pipeline_map = {
                item["step"]: item["status"]
                for item in pipeline_status["data"]["steps"]
            }
            self.assertEqual(pipeline_map, {
                "clean": "stale",
                "model": "stale",
                "paper": "stale",
            })

            result_verify = json_cli(
                root,
                "research-result",
                "verify",
                "--json",
                expected=1,
            )
            self.assertFalse(result_verify["ok"])
            self.assertEqual(
                result_verify["data"]["results"][0]["status"],
                "stale",
            )

            release_after_change = json_cli(
                root,
                "research-check",
                "--release",
                "--json",
                expected=1,
            )
            self.assertFalse(release_after_change["ok"])
            self.assertFalse(release_after_change["data"]["release_gate"]["ready"])
            self.assertGreater(
                release_after_change["data"]["release_gate"]["blocking_errors"],
                0,
            )

    def test_future_schema_fails_safely_in_machine_mode(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            (root / "research.yaml").write_text(
                "schema: 99\nproject:\n  slug: future\n  title: Future\n",
                encoding="utf-8",
            )
            status = json_cli(
                root,
                "research-status",
                "--json",
                expected=2,
            )
            self.assertFalse(status["ok"])
            self.assertEqual(status["error"]["code"], "RESEARCH_ERROR")
            self.assertIn("高于当前支持", status["error"]["message"])


if __name__ == "__main__":
    unittest.main()
