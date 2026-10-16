import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-doctor"


class DoctorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = runpy.run_path(str(SCRIPT))

    def test_declared_route_atoms_are_probed(self):
        registry = set(self.module["BINARIES"]) | {"ghidra-headless"} | {
            "py:" + name for name in self.module["MODULES"]
        }
        for route in self.module["ROUTES"].values():
            self.assertFalse((set(route["required"]) | set(route["optional"])) - registry)

    def test_missing_required_is_blocked_not_false_negative(self):
        atoms = {name: {"state": "missing"} for name in
                 set(self.module["BINARIES"]) | {"ghidra-headless"} |
                 {"py:" + name for name in self.module["MODULES"]}}
        result = self.module["evaluate"](atoms)
        self.assertEqual(result["android-static"]["state"], "blocked")
        self.assertIn("jadx", result["android-static"]["missing_required"])
        self.assertEqual(result["runtime-frida"]["state"], "blocked")

    def test_external_runtime_never_claimed_available(self):
        atoms = {name: {"state": "found"} for name in
                 set(self.module["BINARIES"]) | {"ghidra-headless"} |
                 {"py:" + name for name in self.module["MODULES"]}}
        result = self.module["evaluate"](atoms)
        self.assertEqual(result["native-static"]["state"], "available")
        self.assertEqual(result["runtime-frida"]["state"], "partial")
        self.assertTrue(result["runtime-frida"]["external_unverified"])

    def test_cli_json_is_diagnostic_only(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "--json", "--route", "wasm-static"],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["schema"], "dsh-reverse-capabilities/v1")
        self.assertEqual(report["basis"], "presence-only")
        self.assertEqual(set(report["capabilities"]), {"wasm-static"})
        self.assertIn(report["capabilities"]["wasm-static"]["state"],
                      {"available", "partial", "blocked"})


if __name__ == "__main__":
    unittest.main()
