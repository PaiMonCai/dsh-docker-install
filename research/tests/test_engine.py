from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from dsh_research.config import load_research_config, load_yaml, write_yaml
from dsh_research.errors import ProjectNotFoundError
from dsh_research.hashing import fingerprint_file, sha256_file, tree_digest
from dsh_research.manifests import load_json, read_jsonl, write_json, write_jsonl
from dsh_research.project import ResearchProject, find_project_root
from dsh_research.vcs import git_state


class ProjectTests(unittest.TestCase):
    def test_find_project_root_from_nested_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_yaml(root / "research.yaml", {"schema": 1})
            nested = root / "src" / "nested"
            nested.mkdir(parents=True)

            self.assertEqual(find_project_root(nested), root.resolve())
            project = ResearchProject.discover(nested)
            self.assertEqual(project.config_path, root.resolve() / "research.yaml")
            self.assertEqual(load_research_config(project)["schema"], 1)

    def test_find_project_root_fails_outside_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ProjectNotFoundError):
                find_project_root(tmp)


class ConfigAndManifestTests(unittest.TestCase):
    def test_yaml_roundtrip_unicode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "research.yaml"
            write_yaml(path, {"schema": 2, "project": {"title": "最低工资与就业"}})
            self.assertEqual(load_yaml(path)["project"]["title"], "最低工资与就业")

    def test_json_and_jsonl_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.json"
            stream = root / "sources.jsonl"

            write_json(manifest, {"schema": 1, "ok": True})
            self.assertEqual(load_json(manifest), {"schema": 1, "ok": True})
            self.assertTrue(manifest.read_text(encoding="utf-8").endswith("\n"))

            rows = [{"id": "a", "title": "论文 A"}, {"id": "b", "title": "Paper B"}]
            write_jsonl(stream, rows)
            self.assertEqual(read_jsonl(stream), rows)


class HashingTests(unittest.TestCase):
    def test_file_and_tree_hashes_are_stable_and_sensitive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.txt").write_text("alpha\n", encoding="utf-8")
            (root / "nested").mkdir()
            (root / "nested" / "b.txt").write_text("beta\n", encoding="utf-8")

            first = tree_digest(root)
            second = tree_digest(root)
            self.assertEqual(first, second)

            fp = fingerprint_file(root / "a.txt", relative_to=root)
            self.assertEqual(fp.path, "a.txt")
            self.assertEqual(fp.sha256, sha256_file(root / "a.txt"))
            self.assertEqual(fp.size, len("alpha\n".encode()))

            (root / "nested" / "b.txt").write_text("changed\n", encoding="utf-8")
            self.assertNotEqual(first, tree_digest(root))


    def test_tree_hash_distinguishes_missing_empty_and_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            missing = root / "missing"
            empty = root / "empty"
            empty.mkdir()
            file_path = root / "empty.txt"
            file_path.write_text("", encoding="utf-8")

            self.assertNotEqual(tree_digest(missing), tree_digest(empty))
            self.assertNotEqual(tree_digest(empty), tree_digest(file_path))
            self.assertNotEqual(tree_digest(missing), tree_digest(file_path))


class GitTests(unittest.TestCase):
    def test_git_state_for_non_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            state = git_state(tmp)
            self.assertFalse(state.available)
            self.assertIsNone(state.commit)
            self.assertIsNone(state.dirty)

    def test_git_state_detects_commit_and_dirty_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "DSH Test"], check=True)
            subprocess.run(
                ["git", "-C", str(root), "config", "user.email", "dsh@example.invalid"],
                check=True,
            )
            (root / "tracked.txt").write_text("one\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "tracked.txt"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "test"], check=True)

            clean = git_state(root)
            self.assertTrue(clean.available)
            self.assertIsNotNone(clean.commit)
            self.assertFalse(clean.dirty)

            (root / "tracked.txt").write_text("two\n", encoding="utf-8")
            self.assertTrue(git_state(root).dirty)


if __name__ == "__main__":
    unittest.main()
