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

    def test_peek_uses_global_oldest_queue_order_and_omits_sensitive_inputs(self):
        older = self.mod["enqueue"]("triage", [str(self.source)])
        staged = self.mod["enqueue"]("triage", [str(self.source)], stage=True)
        newer = self.mod["enqueue"]("diff", [str(self.source), str(self.source)])
        result = self.mod["peek"]()
        self.assertEqual(result["schema"], "dsh-reverse-queue-status/v1")
        self.assertEqual(result["head_id"], older["id"])
        self.assertEqual(result["head_kind"], "triage")
        self.assertEqual(result["queued_count"], 2)
        self.assertEqual(result["staged_count"], 1)
        self.assertNotIn(str(self.source), json.dumps(result))
        self.assertNotIn("inputs", result)
        self.assertNotEqual(result["head_id"], newer["id"])
        self.assertNotEqual(result["head_id"], staged["id"])

    def test_task_history_is_bounded_and_does_not_copy_tool_output(self):
        job = self.mod["enqueue"]("triage", [str(self.source)], stage=True)
        self.assertEqual(job["events"][0]["action"], "staged")
        self.mod["publish"](job["id"])
        class Process:
            returncode = 0
            def communicate(self, timeout=None):
                return b"PRIVATE_OUTPUT_SHOULD_NOT_APPEAR_IN_EVENTS", b""
        with patch.object(self.mod["worker_once"].__globals__["subprocess"], "Popen", return_value=Process()):
            final = self.mod["worker_once"]()
        self.assertEqual([x["action"] for x in final["events"]],
                         ["staged", "published", "started", "completed"])
        self.assertEqual(final["result"]["exit_code"], 0)
        self.assertNotIn("PRIVATE_OUTPUT", json.dumps(final["events"]))
        self.assertNotIn(str(self.source), json.dumps(final["events"]))

    def test_legacy_task_records_gain_trace_only_on_new_transitions(self):
        job = self.mod["enqueue"]("triage", [str(self.source)])
        job.pop("events")
        job["state"] = "failed"
        job["attempts"] = 1
        self.mod["atomic"](self.mod["task_path"](job["id"]), job)
        again = self.mod["retry"](job["id"])
        self.assertEqual(len(again["events"]), 1)
        self.assertEqual(again["events"][0]["action"], "retried")
        self.assertEqual(again["events"][0]["state"], "queued")

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

    def test_stage_publish_and_discard_share_same_queue_validation(self):
        staged = self.mod["enqueue"]("triage", [str(self.source)], stage=True)
        self.assertEqual(staged["state"], "staging")
        self.assertEqual(self.mod["worker_once"]()["status"], "idle")
        live = self.mod["publish"](staged["id"])
        self.assertEqual(live["state"], "queued")
        with self.assertRaises(ValueError):
            self.mod["discard"](staged["id"])
        abandoned = self.mod["enqueue"]("triage", [str(self.source)], stage=True)
        self.assertTrue(self.mod["discard"](abandoned["id"])["discarded"])
        with self.assertRaises(ValueError):
            self.mod["read_task"](abandoned["id"])

    def test_publish_refuses_missing_target_and_broken_case_binding(self):
        staged = self.mod["enqueue"]("triage", [str(self.source)], stage=True)
        self.source.unlink()
        with self.assertRaises(ValueError):
            self.mod["publish"](staged["id"])
        self.assertEqual(self.mod["read_task"](staged["id"])["state"], "staging")

if __name__ == "__main__":
    unittest.main()


