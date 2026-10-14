import os
from pathlib import Path
import runpy
import tempfile
import unittest
from contextlib import ExitStack

SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "reverse-js-triage"

class ReverseJsTriageTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.old = os.environ.get("DSH_REVERSE_WORKSPACE_ROOT")
        os.environ["DSH_REVERSE_WORKSPACE_ROOT"] = str(self.root)
        self.addCleanup(self._restore)
        self.module = runpy.run_path(str(SCRIPT))
    def _restore(self):
        if self.old is None:
            os.environ.pop("DSH_REVERSE_WORKSPACE_ROOT", None)
        else:
            os.environ["DSH_REVERSE_WORKSPACE_ROOT"] = self.old
    def test_electron_project(self):
        (self.root/"package.json").write_text('{"name":"demo","main":"main.js"}')
        (self.root/"main.js").write_text(
            'const { BrowserWindow, ipcMain } = require("electron");\n'
            'new BrowserWindow(); ipcMain.handle("ping",()=>42);\n')
        report = self.module["analyze"](str(self.root))
        self.assertEqual(report["schema"], "dsh-reverse-js-triage/v1")
        self.assertEqual(report["files_scanned"], 2)
        main = next(x for x in report["entries"] if x["path"] == "main.js")
        self.assertIn("ipc", main["signals"])
        self.assertEqual(len(main["sha256"]), 64)
    def test_ignores_node_modules_and_symlinks(self):
        node_modules = self.root/"node_modules"
        node_modules.mkdir()
        (node_modules/"hidden.js").write_text("eval('x')")
        (self.root/"linked.js").symlink_to("/etc/passwd")
        (self.root/"safe.js").write_text("const x=1")
        report = self.module["analyze"](str(self.root))
        self.assertEqual(report["files_scanned"], 1)
        self.assertEqual(report["entries"][0]["path"], "safe.js")
    def test_rejects_external_input(self):
        with tempfile.NamedTemporaryFile(suffix=".js") as outside:
            with self.assertRaises(ValueError):
                self.module["analyze"](outside.name)
    def test_rejects_binary(self):
        (self.root/"test.exe").write_bytes(b"MZ")
        with self.assertRaises(ValueError):
            self.module["analyze"](str(self.root/"test.exe"))

if __name__ == "__main__":
    unittest.main()
