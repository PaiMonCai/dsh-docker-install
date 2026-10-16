import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch
SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-task"

class ReverseTaskTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = Path(self.tmp.name)
        self.mod = runpy.run_path(str(SCRIPT))
        # runpy returns the globals dictionary for each function
        self.mod["enqueue"].__globals__["ROOT"] = self.workspace
        self.mod["enqueue"].__globals__["STORE"] = self.workspace / ".reverse-tasks"
        self.source = self.workspace / "binary.elf"
        self.source.write_bytes(b"\x7fELF\x02" + b"\0" * 15)

    def test_enqueue_and_durable_state(self):
        job = self.mod["enqueue"]("triage", [str(self.source)])
        self.assertEqual(job["state"], "queued")
        self.assertEqual(self.mod["read_task"](job["id"])["state"], "queued")
        with self.assertRaises(ValueError):
            self.mod["retry"](job["id"])
        self.assertEqual(self.mod["recover"]()["interrupted"], [])

    def test_worker_calls_only_allowlisted_executable_without_shell(self):
        job = self.mod["enqueue"]("triage", [str(self.source)])
        class Process:
            returncode = 0
            def communicate(self, timeout=None):
                return b'{"status":"ok"}', b''
        with patch.object(self.mod["worker_once"].__globals__["subprocess"], "Popen", return_value=Process()) as runner:
            output = self.mod["worker_once"]()
        self.assertEqual(output["state"], "succeeded")
        argv = runner.call_args.args[0]
        self.assertEqual(argv[0], "reverse-triage")
        self.assertFalse(runner.call_args.kwargs["shell"])
        self.assertTrue(runner.call_args.kwargs["start_new_session"])
        self.assertEqual(self.mod["read_task"](job["id"])["attempts"], 1)

    def test_timeout_kills_child_process_group(self):
        from subprocess import TimeoutExpired
        job = self.mod["enqueue"]("triage", [str(self.source)])
        class Process:
            pid = 12345
            returncode = -15
            calls = 0
            def communicate(self, timeout=None):
                self.calls += 1
                if self.calls == 1:
                    raise TimeoutExpired("reverse-triage", timeout)
                return b"", b""
        with patch.object(self.mod["worker_once"].__globals__["subprocess"], "Popen", return_value=Process()):
            with patch.object(self.mod["worker_once"].__globals__["os"], "killpg") as kill:
                result = self.mod["worker_once"]()
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["last_error"], "TimeoutExpired")
        kill.assert_called_once_with(12345, self.mod["worker_once"].__globals__["signal"].SIGTERM)

    def test_failed_and_interrupted_require_explicit_retry(self):
        job = self.mod["enqueue"]("triage", [str(self.source)])
        job["state"] = "running"
        self.mod["atomic"](self.mod["task_path"](job["id"]), job)
        self.assertEqual(self.mod["recover"]()["interrupted"], [job["id"]])
        self.assertEqual(self.mod["read_task"](job["id"])["state"], "interrupted")
        result = self.mod["retry"](job["id"])
        self.assertEqual(result["state"], "queued")

    def test_input_path_and_task_id_validation(self):
        with self.assertRaises(ValueError):
            self.mod["enqueue"]("shell", [str(self.source)])
        (self.workspace / "linked").symlink_to(self.source)
        with self.assertRaises(ValueError):
            self.mod["enqueue"]("triage", [str(self.workspace / "linked")])
        with self.assertRaises(ValueError):
            self.mod["read_task"]("../../etc/passwd")

    def test_case_binding_is_metadata_and_old_tasks_stay_compatible(self):
        case_id = "57e20024-3c1e-44fe-b2b7-62fbb6fdbedd"
        source = self.workspace / ".reverse-cases"
        source.mkdir()
        (source / (case_id + ".json")).write_text(json.dumps({
            "schema": "dsh-reverse-case/v1", "id": case_id,
            "target": {"path": self.source.name}
        }), encoding="utf-8")
        self.mod["enqueue"].__globals__["CASES"] = source
        old = self.mod["enqueue"]("triage", [str(self.source)])
        bound = self.mod["enqueue"]("triage", [str(self.source)], case_id)
        self.assertNotIn("case_id", old)
        self.assertEqual(bound["case_id"], case_id)
        with self.assertRaises(ValueError):
            self.mod["enqueue"]("triage", [str(self.source)], "bad-id")
        (source / (case_id + ".json")).write_text('{"schema":"wrong","id":"' + case_id + '"}')
        with self.assertRaises(ValueError):
            self.mod["enqueue"]("triage", [str(self.source)], case_id)

    def test_expected_task_id_rejects_non_head(self):
        first = self.mod["enqueue"]("triage", [str(self.source)])
        second = self.mod["enqueue"]("triage", [str(self.source)])
        with self.assertRaises(ValueError):
            self.mod["worker_once"](second["id"])
        self.assertEqual(self.mod["read_task"](first["id"])["state"], "queued")

if __name__ == "__main__":
    unittest.main()

