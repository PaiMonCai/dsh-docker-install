import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-case"


class CaseEngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.m = runpy.run_path(str(SCRIPT))
        for val in self.m.values():
            if callable(val) and hasattr(val, "__globals__") and val.__globals__.get("SCHEMA") == "dsh-reverse-case/v1":
                val.__globals__["ROOT"] = self.root
                val.__globals__["STORE"] = self.root / ".reverse-cases"
                val.__globals__["TASKS"] = self.root / ".reverse-tasks"
        self.target = self.root / "program.bin"
        self.target.write_bytes(b"\x7fELF\x02" + b"\x00" * 20)
        self.report = self.root / "report.json"
        self.report.write_text('{"schema":"dsh-reverse-evidence/v1"}', encoding="utf-8")

    def test_case_lifecycle_persists_and_verifies(self):
        case = self.m["create"](str(self.target), "map startup logic", "evidence report")
        key = case["id"]
        self.assertEqual(case["gates"]["G1"]["state"], "pending")
        self.assertTrue(self.m["verify"](case)["passed"])
        self.m["mutate"](key, lambda c: self.m["add_evidence"](c, str(self.report),
                          "symbol:main", "entry calls init", "observed", "reverse-triage"))
        self.m["mutate"](key, lambda c: self.m["set_gate"](c, "G3", "passed",
                          "static cross-reference maps the owner", ["E001"]))
        self.m["mutate"](key, lambda c: self.m["add_hypothesis"](c,
                          "init controls startup", "a control trace not reaching init"))
        self.m["mutate"](key, lambda c: self.m["add_experiment"](c,
                          "H001", "startup parameter", "same input and runtime",
                          "the trace contains no init call"))
        self.m["mutate"](key, lambda c: self.m["record_experiment"](c,
                          "X001", "observed", ["E001"], "static fixture demonstration"))
        self.m["mutate"](key, lambda c: self.m["assess"](c, "H001", "refuted",
                          ["E001"], "counterexample documented"))
        saved = self.m["read_case"](key)
        self.assertEqual(saved["revision"], 7)
        self.assertEqual(saved["hypotheses"][0]["state"], "refuted")
        self.assertEqual(saved["experiments"][0]["state"], "observed")
        self.assertEqual(len(self.m["list_cases"]()), 1)
        self.report.write_text("changed", encoding="utf-8")
        self.assertFalse(self.m["verify"](saved)["passed"])
        self.assertFalse(self.m["verify"](saved)["results"][1]["verified"])

    def test_refuse_unsupported_claims_and_bad_transitions(self):
        case = self.m["create"](str(self.target), "trace", "report")
        key = case["id"]
        with self.assertRaisesRegex(ValueError, "observed evidence"):
            self.m["mutate"](key, lambda c: self.m["set_gate"](c, "G2", "passed", "tool ready", []))
        self.m["mutate"](key, lambda c: self.m["add_evidence"](c, str(self.report),
                          "0x0", "guess", "inferred", "tool"))
        with self.assertRaisesRegex(ValueError, "requires observed evidence"):
            self.m["mutate"](key, lambda c: self.m["set_gate"](c, "G3", "passed", "mapped", ["E001"]))
        with self.assertRaisesRegex(ValueError, "reference does not exist"):
            self.m["mutate"](key, lambda c: self.m["assess"](c, "H999", "refuted", ["E001"], "wrong"))
        self.assertEqual(self.m["read_case"](key)["revision"], 2)

    def test_directory_target_has_reproducible_hash_and_detects_new_files(self):
        folder = self.root / "electron"
        folder.mkdir()
        (folder / "main.js").write_text("console.log('hello')", encoding="utf-8")
        case = self.m["create"](str(folder), "map IPC", "call graph")
        self.assertEqual(case["target"]["kind"], "directory")
        self.assertEqual(case["target"]["file_count"], 1)
        self.assertTrue(self.m["verify"](case)["passed"])
        (folder / "worker.js").write_text("module.exports = 1", encoding="utf-8")
        self.assertFalse(self.m["verify"](case)["passed"])
        case2 = self.m["create"](str(folder), "map IPC", "call graph")
        self.assertTrue(self.m["verify"](case2)["passed"])
        (folder / "linked").symlink_to(self.target)
        self.assertFalse(self.m["verify"](case2)["passed"])

    def test_workspace_symlink_and_outside_rejected(self):
        with self.assertRaises(ValueError):
            self.m["create"]("/etc/hosts", "no", "report")
        (self.root / "sub").mkdir()
        (self.root / "shortcut").symlink_to(self.root / "sub")
        (self.root / "sub" / "file").write_bytes(b"x")
        with self.assertRaises(ValueError):
            self.m["create"](str(self.root / "shortcut" / "file"), "no", "report")

    def test_reject_lock_and_task_directory_symlinks(self):
        lock_dir = self.root / ".reverse-cases"
        lock_dir.mkdir()
        (lock_dir / ".lock").symlink_to(self.target)
        with self.assertRaises(ValueError):
            self.m["create"](str(self.target), "safe", "report")
        (lock_dir / ".lock").unlink()
        case = self.m["create"](str(self.target), "safe", "report")
        fake = self.root / "outside"
        fake.mkdir()
        (self.root / ".reverse-tasks").symlink_to(fake)
        with self.assertRaises(ValueError):
            self.m["mutate"](case["id"], lambda c: self.m["attach_task"](
                c, "01234567-89ab-4cde-8f00-123456789abc"))

    def test_task_links_are_explicit_and_do_not_read_stdout(self):
        case = self.m["create"](str(self.target), "verify route", "report")
        tid = "01234567-89ab-4cde-8f00-123456789abc"
        task_dir = self.root / ".reverse-tasks"
        task_dir.mkdir()
        (task_dir / (tid + ".json")).write_text(json.dumps({
            "schema": "dsh-reverse-task/v1", "id": tid, "case_id": case["id"],
            "kind": "triage", "state": "succeeded", "attempts": 1,
            "result": {"exit_code": 0, "stdout": "secret should not be copied"}
        }))
        self.m["mutate"](case["id"], lambda c: self.m["attach_task"](c, tid))
        saved = self.m["read_case"](case["id"])
        self.assertEqual(saved["tasks"][0]["state"], "succeeded")
        self.assertNotIn("secret", json.dumps(saved))
        (task_dir / (tid + ".json")).write_text(json.dumps({
            "schema": "dsh-reverse-task/v1", "id": tid, "case_id": "other",
            "kind": "triage", "state": "succeeded"
        }))
        with self.assertRaises(ValueError):
            self.m["mutate"](case["id"], lambda c: self.m["attach_task"](c, tid))


if __name__ == "__main__":
    unittest.main()
