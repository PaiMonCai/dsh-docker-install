import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "report-reader-mcp" / "reader.py"
spec = importlib.util.spec_from_file_location("report_reader", MODULE)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ReportReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write_log(self, results, **run_fields):
        run = {"tool": {"driver": {"name": "test-scanner", "version": "1", "rules": [
            {"id": "security/check", "defaultConfiguration": {"level": "error"}}
        ]}}, "results": results, **run_fields}
        path = self.root / "findings.sarif"
        path.write_text(json.dumps({"version": "2.1.0", "runs": [run]}), encoding="utf-8")
        return path

    def test_rule_inheritance_pagination_and_retained_duplicate_suppression(self):
        result = {"ruleId": "security/check", "ruleIndex": 0, "message": {"text": "bad input"},
                  "partialFingerprints": {"id": "one"},
                  "locations": [{"physicalLocation": {"artifactLocation": {"uri": "src/auth.py"},
                                                    "region": {"startLine": 12}}}],
                  "suppressions": [{"kind": "external", "status": "accepted"}],
                  "baselineState": "unchanged"}
        path = self.write_log([result, result, {**result, "kind": "pass"}])
        before = path.read_bytes()
        page = reader.read_sarif(self.root, str(path), limit=1, level="error")
        self.assertEqual(page["counts_by_level"], {"error": 2, "none": 1})
        self.assertEqual(page["matching_results"], 2)
        self.assertEqual(page["next_offset"], 1)
        self.assertEqual(page["source"]["sha256"], hashlib.sha256(before).hexdigest())
        self.assertEqual(page["results"][0]["locations"][0]["region"]["startLine"], 12)
        following = reader.read_sarif(self.root, str(path), offset=1, limit=1, level="error")
        self.assertTrue(following["results"][0]["duplicate_hint"])
        self.assertEqual(following["results"][0]["suppression_statuses"], ["accepted"])
        self.assertEqual(following["results"][0]["baseline_state"], "unchanged")
        self.assertIsNone(following["next_offset"])
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(reader.read_sarif(self.root, str(path))["duplicate_hints"], 1)

    def test_extension_rules_and_indexed_artifacts_are_resolved_without_fetching(self):
        tool = {"driver": {"name": "driver"}, "extensions": [
            {"name": "extension", "rules": [{"id": "ext-rule", "defaultConfiguration": {"level": "note"}}]}
        ]}
        path = self.write_log([{
            "rule": {"index": 0, "toolComponent": {"index": 0}},
            "message": {"text": "extension observation"},
            "locations": [{"physicalLocation": {"artifactLocation": {"index": 0}}}],
        }], tool=tool, artifacts=[{"location": {"uri": "https://example.invalid/source"}}])
        row = reader.read_sarif(self.root, str(path))["results"][0]
        self.assertEqual(row["rule_id"], "ext-rule")
        self.assertEqual(row["rule_component"], "extension")
        self.assertEqual(row["level"], "note")
        self.assertEqual(row["locations"][0]["uri"], "https://example.invalid/source")
        path = self.write_log([{
            "rule": {"index": 0, "toolComponent": {"index": 9}},
            "message": {"text": "invalid extension"},
        }], tool=tool)
        with self.assertRaisesRegex(ValueError, "tool component index"):
            reader.read_sarif(self.root, str(path))

    def test_explicit_severity_wins_and_unclassified_defaults_to_warning(self):
        path = self.write_log([
            {"ruleId": "security/check", "level": "note", "message": {"text": "explicit"}},
            {"ruleId": "missing-rule", "message": {"text": "unclassified"}},
        ])
        self.assertEqual(reader.read_sarif(self.root, str(path))["counts_by_level"],
                         {"note": 1, "warning": 1})

    def test_invalid_sarif_is_not_a_clean_scan(self):
        for content in [{"version": "2.1.0", "runs": [None]}, {"version": "2.0", "runs": []},
                        {"version": "2.1.0", "runs": [{"results": []}]},
                        {"version": "2.1.0", "runs": [{"results": [None]}]}]:
            path = self.root / "bad.json"
            path.write_text(json.dumps(content), encoding="utf-8")
            with self.assertRaises(ValueError):
                reader.read_sarif(self.root, str(path))
        path = self.write_log([{"ruleId": "wrong", "ruleIndex": 0}])
        with self.assertRaisesRegex(ValueError, "disagree"):
            reader.read_sarif(self.root, str(path))

    def test_filtered_invalid_rows_and_configuration_overrides_cannot_look_clean(self):
        path = self.write_log([{"ruleId": "one", "level": "note"}])
        with self.assertRaisesRegex(ValueError, "message"):
            reader.read_sarif(self.root, str(path), level="error")
        path = self.write_log([{"kind": "pass", "level": "error", "message": {"text": "invalid"}}])
        with self.assertRaisesRegex(ValueError, "non-fail"):
            reader.read_sarif(self.root, str(path))
        path = self.write_log([{"ruleId": "one", "message": {"text": "override not resolved"}}],
                              invocations=[{"ruleConfigurationOverrides": [
                                  {"descriptor": {"id": "one"}, "configuration": {"level": "error"}}
                              ]}])
        self.assertFalse(reader.read_sarif(self.root, str(path), level="error")["severity_complete"])

    def test_uri_traversal_outside_and_oversized_files_rejected(self):
        for path in ["https://example.invalid/report.pdf", "file:///workspace/report.pdf",
                     "data:application/pdf,hello", "../outside.pdf", str(self.root.parent / "outside.pdf")]:
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                reader.local_bytes(self.root, path)
        path = self.root / "large.json"
        with path.open("wb") as out:
            out.truncate(reader.MAX_INPUT + 1)
        with self.assertRaisesRegex(ValueError, "8 MiB"):
            reader.local_bytes(self.root, str(path))
        with self.assertRaises(ValueError):
            reader.read_document(self.root, "large.json")

    def test_symlinked_parent_is_rejected(self):
        target = self.root / "reports"
        target.mkdir()
        (target / "one.json").write_text("{}")
        linked = self.root / "linked"
        try:
            linked.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("symlinks unavailable on this host")
        with self.assertRaisesRegex(ValueError, "linked"):
            reader.local_bytes(self.root, str(linked / "one.json"))

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO requires POSIX")
    def test_fifo_is_rejected_without_blocking(self):
        path = self.root / "input.pdf"
        os.mkfifo(path)
        with self.assertRaisesRegex(ValueError, "regular file"):
            reader.local_bytes(self.root, str(path))

    def test_archive_budget_and_page_arguments(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("expanded.xml", b"x" * (33 * 1024 * 1024))
        with self.assertRaisesRegex(ValueError, "expansion"):
            reader.check_archive(data.getvalue())
        for options in [dict(offset=-1), dict(limit=26), dict(limit=True), dict(level="critical")]:
            with self.assertRaises(ValueError):
                reader.read_sarif(self.root, "unused", **options)
        for options in [dict(start=-1), dict(max_chars=12001)]:
            with self.assertRaises(ValueError):
                reader.read_document(self.root, "unused", **options)


if __name__ == "__main__":
    unittest.main()
