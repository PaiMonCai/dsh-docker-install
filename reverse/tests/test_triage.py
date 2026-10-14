import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from zipfile import ZipFile

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-triage"

class ReverseTriageTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.workspace = Path(self.folder.name)
        os.environ["DSH_REVERSE_WORKSPACE_ROOT"] = str(self.workspace)
        self.addCleanup(os.environ.pop, "DSH_REVERSE_WORKSPACE_ROOT", None)
        self.mod = runpy.run_path(str(SCRIPT))

    def test_elf_and_report(self):
        source = self.workspace / "sample"
        source.write_bytes(b"\x7fELF" + b"\x02\x01" + b"\x00" * 128)
        result = self.mod["analyze"](str(source))
        report = json.loads(Path(result["report"]).read_text())
        self.assertEqual(report["schema"], "dsh-reverse-evidence/v1")
        self.assertEqual(report["analysis"]["format"], "ELF")
        self.assertEqual(report["evidence"][0]["locator"], "header@0x0")
        self.assertEqual(len(report["sample"]["sha256"]), 64)
        self.assertTrue(Path(result["markdown"]).is_file())

    def test_archive_no_extraction(self):
        source = self.workspace / "archive.zip"
        with ZipFile(source, "w") as output:
            output.writestr("AndroidManifest.xml", "test")
            output.writestr("../escape", "must-not-be-extracted")
        result = self.mod["analyze"](str(source))
        report = json.loads(Path(result["report"]).read_text())
        self.assertTrue(report["analysis"]["archive"]["apk"])
        self.assertFalse((self.workspace / "escape").exists())

    def test_workspace_boundary(self):
        with tempfile.NamedTemporaryFile() as external:
            external.write(b"MZ" + b"\x00" * 30)
            external.flush()
            with self.assertRaises(ValueError):
                self.mod["analyze"](external.name)

    def test_symlink_is_rejected(self):
        good = self.workspace / "good"
        good.write_bytes(b"test")
        (self.workspace / "linked").symlink_to(good)
        with self.assertRaises(ValueError):
            self.mod["analyze"](str(self.workspace / "linked"))

    def test_output_escape_rejected(self):
        source = self.workspace / "safe"
        source.write_bytes(b"test")
        with self.assertRaises(ValueError):
            self.mod["analyze"](str(source), "/tmp/outside")

if __name__ == "__main__":
    unittest.main()
