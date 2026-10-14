import os
from pathlib import Path
import runpy
import tempfile
import unittest
D = Path(__file__).resolve().parents[1] / "bin" / "reverse-diff"

class ReverseDiffTest(unittest.TestCase):
    def setUp(self):
        self.mod = runpy.run_path(str(D))
    def report(self, funcs, edges=()):
        return {"schema":"dsh-reverse-ghidra/v2", "program":"sample",
                "functions":[{"address":k,"name":v,"signature":"int()","pseudocode":"return 1;"}
                             for k,v in funcs.items()],
                "call_graph":{"edges":[{"source":s,"target":t,"kind":"call"}
                                       for s,t in edges]}}
    def test_changed_functions_and_edges(self):
        a = self.report({"100":"old","200":"unchanged"}, [("100","200")])
        b = self.report({"100":"new","300":"added"}, [("100","300")])
        diff = self.mod["compare"](a,b)
        self.assertEqual(diff["schema"], "dsh-reverse-diff/v1")
        self.assertEqual(diff["functions_added"], ["300"])
        self.assertEqual(diff["functions_removed"], ["200"])
        self.assertEqual(diff["functions_modified"][0]["fields"], ["name"])
        self.assertEqual(len(diff["edges_added"]), 1)
        self.assertEqual(len(diff["edges_removed"]), 1)
    def test_rejects_bad_graph(self):
        a = self.report({"100":"a"})
        a["call_graph"]["edges"] = [{"source":"100","target":None,"kind":"call"}]
        with self.assertRaises(ValueError):
            self.mod["summarize"](a)
    def test_schema_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            self.mod["ROOT"] = Path(td)
            f = Path(td)/"report.json"
            f.write_text('{"schema":"other","functions":[]}')
            with self.assertRaises(ValueError):
                self.mod["load"](str(f))
if __name__ == "__main__": unittest.main()
