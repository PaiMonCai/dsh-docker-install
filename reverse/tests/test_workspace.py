import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-workspace"

class ReverseWorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.m = runpy.run_path(str(SCRIPT))
        self.m["ROOT"] = self.root
        # runpy globals referenced by indexed function objects are updated here
        self.m["index"].__globals__["ROOT"] = self.root

    def test_index_and_verify(self):
        f = self.root / "report.json"
        f.write_text(json.dumps({"schema": "dsh-reverse-evidence/v1", "sample": {}}))
        result = self.m["index"]([str(f)])
        self.assertEqual(result["schema"], "dsh-reverse-workspace/v1")
        self.assertEqual(len(result["reports"]), 1)
        self.assertTrue(self.m["verify"](result)["passed"])
        f.write_text(json.dumps({"schema": "dsh-reverse-evidence/v1", "sample": {"changed": True}}))
        self.assertFalse(self.m["verify"](result)["passed"])

    def test_index_accepts_case_snapshot_but_detects_changes(self):
        case = self.root / "case.json"
        case.write_text(json.dumps({"schema":"dsh-reverse-case/v1","revision":1}))
        manifest = self.m["index"]([str(case)])
        self.assertEqual(manifest["reports"][0]["schema"], "dsh-reverse-case/v1")
        self.assertTrue(self.m["verify"](manifest)["passed"])
        case.write_text(json.dumps({"schema":"dsh-reverse-case/v1","revision":2}))
        self.assertFalse(self.m["verify"](manifest)["passed"])

    def test_schema_and_symlink_rejected(self):
        f = self.root / "bad.json"
        f.write_text('{"schema":"not-a-report"}')
        with self.assertRaises(ValueError):
            self.m["index"]([str(f)])
        (self.root / "link.json").symlink_to(f)
        with self.assertRaises(ValueError):
            self.m["index"]([str(self.root / "link.json")])

    def test_manifest_path_traversal_rejected(self):
        with self.assertRaises(ValueError):
            self.m["verify"]({"schema": "dsh-reverse-workspace/v1",
                              "reports": [{"path": "../outside", "sha256": "no"}]})

if __name__ == "__main__":
    unittest.main()
