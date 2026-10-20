import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
import subprocess
sys.dont_write_bytecode = True

SPEC = importlib.util.spec_from_file_location("manager", Path(__file__).resolve().parents[1] / "docker/dsh-web-manager.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeManager(MODULE.Manager):
    def describe(self):
        return {"name": "dsh-test", "image": getattr(self, "target", "example/dsh:latest"), "edition": "standard"}

    def inspect(self, name):
        if name.endswith("-proxy"):
            raise RuntimeError("absent")
        return {"Image": getattr(self, "image_id", "sha256:" + "a" * 64),
                "State": {"Status": "running", "Running": True}}

    def run(self, args, timeout=30, merge=False):
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps([{"Os": "linux", "Architecture": "amd64", "Config": {"Labels": {}}}])
        if args[:3] == ["docker", "manifest", "inspect"]:
            return json.dumps({"Descriptor": {"platform": {"os": "linux", "architecture": "amd64"}},
                               "OCIManifest": {"config": {"digest": "sha256:" + "b" * 64}}})
        return "Web at http://localhost/?token=secret"

    def execute(self, job, arguments):
        MODULE.command_for(job["action"], arguments)
        self.executed.append((job["action"], arguments))
        if self.fail:
            raise RuntimeError("failed at https://user:pass@example.com/?token=secret")


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.manager = FakeManager(self.temp.name, "/usr/local/bin/dshd", "test")
        self.manager.executed, self.manager.fail = [], False

    def submit(self, action="restart", arguments=None, identifier=None):
        identifier = identifier or str(uuid.uuid4())
        path = self.manager.requests / (identifier + ".json")
        MODULE.write_json(path, {"id": identifier, "action": action,
                                 "arguments": arguments or {}, "createdAt": MODULE.now()})
        self.manager.process(path)
        return MODULE.read_json(self.manager.results / (identifier + ".json"))

    def test_snapshot_advertises_actual_host_capabilities(self):
        self.manager.snapshot()
        status = MODULE.read_json(self.manager.results / "status.json")
        self.assertEqual(status["management"]["schema"], MODULE.OPERATION_CONTRACT_VERSION)
        self.assertEqual(status["management"]["operations"], list(MODULE.SUPPORTED_OPERATIONS))
        self.assertIn("restart", status["management"]["operations"])
        self.assertNotIn("shell", status["management"]["operations"])

    def test_phase_two_actions_only_dispatch_fixed_commands(self):
        expected = {
            "edition-standard": ["web-switch", "standard"],
            "edition-research": ["web-switch", "research"],
            "pack-none": ["web-switch", "research"],
            "pack-economics": ["web-switch", "research-economics"],
            "dashboard-start": ["dashboard", "start"],
            "dashboard-stop": ["dashboard", "stop"],
            "diagnose-environment": ["env"],
            "diagnose-storage": ["storage", "show"],
            "diagnose-plugins": ["doctor", "plugins", "--json"],
        }
        for action, command in expected.items():
            self.assertEqual(MODULE.command_for(action, {}), command)
            with self.assertRaises(ValueError):
                MODULE.command_for(action, {"image": "attacker/override"})
        self.assertEqual(self.submit("edition-research")["state"], "succeeded")
        self.assertIn(("edition-research", {}), self.manager.executed)

    def test_dashboard_snapshot_is_research_scoped(self):
        self.manager.target = "example/dsh:research"
        self.manager.describe = lambda: {
            "name": "dsh-test", "image": self.manager.target,
            "edition": "research", "researchPack": "none"
        }
        self.manager.snapshot()
        status = MODULE.read_json(self.manager.results / "status.json")
        self.assertTrue(status["dashboard"]["running"])
        self.manager.describe = lambda: {
            "name": "dsh-test", "image": self.manager.target, "edition": "standard"
        }
        self.manager.snapshot()
        status = MODULE.read_json(self.manager.results / "status.json")
        self.assertFalse(status["dashboard"]["running"])

    def test_task_survives_restart_and_is_not_replayed(self):
        job = self.submit()
        self.assertEqual(job["state"], "succeeded")
        self.submit(identifier=job["id"])
        self.assertEqual(len(self.manager.executed), 1)
        restored = FakeManager(self.temp.name, "/usr/local/bin/dshd")
        restored.recover()
        self.assertEqual(MODULE.read_json(restored.results / (job["id"] + ".json"))["state"], "succeeded")

    def test_import_secrets_are_removed_from_history_and_queue(self):
        secret = "trojan://private-password@example.com:443"
        job = self.submit("proxy-add", {"name": "hk", "url": secret})
        self.assertNotIn(secret, json.dumps(job))
        self.assertNotIn("arguments", job)
        self.assertFalse(list(self.manager.requests.glob("*.json")))
        self.assertEqual(self.manager.executed[0][1]["url"], secret)

    def test_failure_is_persisted_and_redacted(self):
        self.manager.fail = True
        job = self.submit()
        self.assertEqual(job["state"], "failed")
        self.assertNotIn("user:pass", job["error"])
        self.assertNotIn("token=secret", job["error"])

    def test_interrupted_mutation_is_never_automatically_replayed(self):
        identifier = str(uuid.uuid4())
        MODULE.write_json(self.manager.results / (identifier + ".json"),
                          {"id": identifier, "action": "update", "state": "running"})
        self.manager.recover()
        self.assertEqual(MODULE.read_json(self.manager.results / (identifier + ".json"))["state"], "interrupted")
        self.assertFalse(self.manager.executed)

    def test_rejects_commands_other_instances_and_malformed_requests(self):
        for action, args in [("shell", {"command": "id"}), ("restart", {"name": "other"}),
                             ("proxy-use", {"name": "../../host"}), ("proxy-subscribe", {"name": "x", "url": "file:///etc/shadow"})]:
            self.assertEqual(self.submit(action, args)["state"], "failed")
        self.assertFalse(self.manager.executed)

    def test_update_check_compares_actual_platform_config(self):
        self.manager.check()
        self.assertTrue(self.manager.release["available"])
        self.manager.snapshot()
        status = MODULE.read_json(self.manager.results / "status.json")
        self.assertNotIn("token=secret", status["logs"])
        manifests = [
            {"Descriptor": {"platform": {"os": "unknown", "architecture": "unknown"}}},
            {"Descriptor": {"platform": {"os": "linux", "architecture": "arm64", "variant": "v8"}},
             "SchemaV2Manifest": {"config": {"digest": "sha256:" + "c" * 64}}},
        ]
        self.assertEqual(MODULE.remote_image_id(manifests, "linux", "arm64", "v8"), "sha256:" + "c" * 64)
        with self.assertRaises(ValueError):
            MODULE.remote_image_id(manifests, "linux", "amd64")

    def test_runtime_log_snapshot_is_bounded_redacted_and_stamped(self):
        self.manager.snapshot()
        status = MODULE.read_json(self.manager.results / "status.json")
        self.assertLessEqual(len(status["logs"]), 48000)
        self.assertIn("logsUpdatedAt", status)
        self.assertNotIn("token=secret", status["logs"])

        secret = ('Authorization: Bearer private-bearer-token\n'
                  'api_key=provider-private-token\n'
                  'password: privatepassword\n'
                  'https://demo:password@example.org/?token=secret\n')
        safe = MODULE.redact(secret)
        for value in ("private-bearer-token", "provider-private-token",
                      "privatepassword", "demo:password", "token=secret"):
            self.assertNotIn(value, safe)

    def test_log_tail_reads_only_target_container_and_is_bounded(self):
        commands = []
        original = self.manager.run
        def traced(args, **kwargs):
            commands.append(args)
            return original(args, **kwargs)
        self.manager.run = traced
        self.manager.snapshot()
        self.assertIn(["docker", "logs", "--tail", "200", "dsh-test"], commands)

    def test_sse_log_ring_is_redacted_bounded_and_atomic(self):
        self.manager.append_log_line("Authorization: Bearer abc-secret")
        for index in range(275):
            self.manager.append_log_line("INFO line %s" % index)
        self.manager.publish_log_stream()
        path = self.manager.results / "log-stream.json"
        stream = MODULE.read_json(path, 65536)
        self.assertEqual(stream["seq"], 276)
        self.assertLessEqual(len(stream["entries"]), 200)
        self.assertEqual(stream["generation"], self.manager.log_generation)
        self.assertLessEqual(path.stat().st_size, 65536)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertIn("INFO line 274", stream["entries"][-1]["text"])
        self.assertNotIn("abc-secret", json.dumps(stream))
        self.assertEqual([line["seq"] for line in stream["entries"]],
                         sorted(line["seq"] for line in stream["entries"]))
        self.manager.append_log_line("password=other-secret")
        self.manager.publish_log_stream()
        updated = MODULE.read_json(path, 65536)
        self.assertEqual(updated["seq"], 277)
        self.assertNotIn("other-secret", json.dumps(updated))
        safe_json = MODULE.redact('{"password": "topsecret", "api_key":"secretkey", "token":"private"}')
        for secret in ("topsecret", "secretkey", "private"):
            self.assertNotIn(secret, safe_json)

    def test_external_upgrade_discards_cached_notice_and_checks_the_running_image(self):
        self.manager.check()
        self.assertTrue(self.manager.release["available"])
        self.manager.image_id = "sha256:" + "b" * 64
        self.manager.snapshot()
        self.assertIsNone(MODULE.read_json(self.manager.results / "status.json")["release"])
        self.assertIsNone(MODULE.read_json(self.manager.private / "release.json"))
        self.assertTrue(self.manager.refresh_pending)
        self.manager.tick()
        self.assertFalse(self.manager.release["available"])
        self.assertEqual(self.manager.release["current"], self.manager.image_id)
        restored = FakeManager(self.temp.name, "/usr/local/bin/dshd")
        restored.recover()
        self.assertFalse(restored.release["available"])

    def test_switching_update_source_invalidates_results_even_with_periodic_checks_disabled(self):
        self.manager.check()
        self.manager.settings["checkInterval"] = 0
        self.manager.target = "example/dsh:reverse"
        self.manager.snapshot()
        self.assertIsNone(self.manager.release)
        self.assertFalse(self.manager.refresh_pending)
        self.assertIsNone(MODULE.read_json(self.manager.private / "release.json"))

    def test_explicit_refresh_runs_once_when_periodic_checks_are_disabled(self):
        self.manager.settings["checkInterval"] = 0
        self.manager.image_id = "sha256:" + "b" * 64
        self.manager.clear_release(recheck=True)
        self.manager.tick()
        self.assertFalse(self.manager.release["available"])
        self.assertFalse(self.manager.refresh_pending)
        self.assertEqual(self.manager.release["target"], "example/dsh:latest")
        previous = self.manager.release["checkedAt"]
        self.manager.tick()
        self.assertEqual(self.manager.release["checkedAt"], previous)

    def test_periodic_checks_continue_without_browser_requests(self):
        commands = []
        run = self.manager.run

        def traced(args, **kwargs):
            commands.append(args)
            return run(args, **kwargs)

        self.manager.run = traced
        with patch.object(MODULE.time, "monotonic", return_value=100):
            self.manager.tick()
        self.assertTrue(self.manager.release["available"])
        self.assertEqual(self.manager.next_check, 100 + 21600)
        with patch.object(MODULE.time, "monotonic", return_value=101):
            self.manager.tick()
        self.assertEqual(sum(args[:3] == ["docker", "manifest", "inspect"] for args in commands), 1)
        commands.clear()
        with patch.object(MODULE.time, "monotonic", return_value=self.manager.next_check):
            self.manager.tick()
        self.assertEqual(sum(args[:3] == ["docker", "manifest", "inspect"] for args in commands), 1)
        self.assertTrue(self.manager.release["available"])
        self.assertFalse(list(self.manager.requests.glob("*.json")))

    def test_registry_failure_is_unknown_and_not_reported_as_latest(self):
        run = self.manager.run
        def unavailable(args, **kwargs):
            if args[:3] == ["docker", "manifest", "inspect"]:
                raise RuntimeError("registry unavailable")
            return run(args, **kwargs)
        self.manager.run = unavailable
        with self.assertRaisesRegex(RuntimeError, "registry unavailable"):
            self.manager.check()
        self.manager.snapshot()
        release = MODULE.read_json(self.manager.results / "status.json")["release"]
        self.assertIsNone(release["available"])
        self.assertIn("registry unavailable", release["error"])

    def test_container_replaced_during_registry_check_cannot_publish_an_outdated_update(self):
        run = self.manager.run
        def changing(args, **kwargs):
            if args[:3] == ["docker", "manifest", "inspect"]:
                self.manager.image_id = "sha256:" + "b" * 64
            return run(args, **kwargs)
        self.manager.run = changing
        with self.assertRaisesRegex(RuntimeError, "instance changed"):
            self.manager.check()
        self.assertIsNone(self.manager.release["available"])
        self.manager.snapshot()
        self.assertIsNone(self.manager.release)

    def test_settings_are_validated_and_persisted_in_private_directory(self):
        self.assertEqual(self.manager.validate_settings({"checkInterval": 86400}), {"checkInterval": 86400})
        for settings in ({"checkInterval": True}, {"checkInterval": 1}, {"checkInterval": 3600, "command": "id"}):
            with self.assertRaises(ValueError):
                self.manager.validate_settings(settings)
        MODULE.Manager.execute(self.manager, {"action": "settings"}, {"checkInterval": 86400})
        self.assertEqual(MODULE.read_json(self.manager.settings_path), {"checkInterval": 86400})

    def test_expired_tasks_do_not_execute_after_a_long_outage(self):
        identifier = str(uuid.uuid4())
        path = self.manager.requests / (identifier + ".json")
        MODULE.write_json(path, {"id": identifier, "action": "update", "arguments": {},
                                 "createdAt": "2000-01-01T00:00:00+00:00"})
        self.manager.process(path)
        job = MODULE.read_json(self.manager.results / (identifier + ".json"))
        self.assertEqual(job["state"], "failed")
        self.assertIn("expired", job["error"])
        self.assertFalse(self.manager.executed)

    def test_browser_iso_timestamp_is_accepted(self):
        identifier = str(uuid.uuid4())
        path = self.manager.requests / (identifier + ".json")
        MODULE.write_json(path, {"id": identifier, "action": "restart", "arguments": {},
                                 "createdAt": MODULE.now().replace("+00:00", "Z")})
        self.manager.process(path)
        self.assertEqual(MODULE.read_json(self.manager.results / (identifier + ".json"))["state"], "succeeded")

    @unittest.skipUnless(os.name == "posix", "requires POSIX flock")
    def test_cli_rejects_a_concurrent_instance_mutation(self):
        import fcntl
        with open(self.manager.state / "operation.lock", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            script = Path(__file__).resolve().parents[1] / "dshd"
            result = subprocess.run(["bash", str(script), "restart"], env=self.manager.env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("已有操作", result.stderr.decode("utf-8"))

    @unittest.skipUnless(os.name == "posix", "requires POSIX symlinks and process pipes")
    def test_symlink_requests_do_not_read_or_modify_host_files(self):
        secret = Path(self.temp.name) / "secret"
        secret.write_text('{"password":"private"}')
        path = self.manager.requests / (str(uuid.uuid4()) + ".json")
        path.symlink_to(secret)
        self.manager.process(path)
        self.assertEqual(secret.read_text(), '{"password":"private"}')
        self.assertFalse(self.manager.executed)

    @unittest.skipUnless(os.name == "posix", "requires POSIX process pipes")
    def test_real_executor_streams_output_and_propagates_failure(self):
        script = Path(self.temp.name) / "fake-dshd"
        script.write_text('printf "step one\\n"; sleep 0.1; printf "step two\\n"; exit 7\n')
        self.manager.dshd = str(script)
        job = {"id": str(uuid.uuid4()), "action": "restart", "state": "running", "log": ""}
        with self.assertRaisesRegex(RuntimeError, "exit 7"):
            MODULE.Manager.execute(self.manager, job, {})
        self.assertIn("step one", job["log"])
        self.assertIn("step two", job["log"])


if __name__ == "__main__":
    unittest.main()
