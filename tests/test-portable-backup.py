#!/usr/bin/env python3
"""Isolated stdlib integration tests for portable DSH backup (no Docker daemon)."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "dsh_portable", ROOT / "docker/dsh-portable-backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.state = self.base / "source-state"
        self.data = self.base / "source-data"
        self.workspace = self.base / "source-workspace"
        self.mount = self.base / "custom-mount"
        for place in (self.state, self.data, self.workspace, self.mount):
            place.mkdir()
        (self.state / "config.env").write_text("DSH_NAME=dsh\n")
        (self.state / "container.env").write_text("CUSTOM_FLAG=1\n")
        (self.state / "proxy").mkdir()
        (self.state / "proxy" / "config.json").write_text('{"tag":"proxy"}')
        (self.state / "backups").mkdir()
        (self.state / "backups" / "old.dshbak").write_text("recursive leak")
        (self.data / "session.json").write_text("secret-session")
        (self.workspace / "project.txt").write_text("project source")
        (self.mount / "tool.conf").write_text("custom config")
        (self.state / "mounts.conf").write_text(
            str(self.mount) + "|/root/.config/custom|ro\n")
        self.bundle = self.base / "snapshot.dshbak"
        self.digest = "ghcr.io/example/dsh@sha256:" + "a" * 64

    def fake_docker(self, *args, **kwargs):
        if args[0] == "inspect":
            return subprocess.CompletedProcess(args, 0, b"exited", b"")
        if args[:2] == ("image", "inspect"):
            return subprocess.CompletedProcess(args, 0,
                                               self.digest.encode() + b"\n", b"")
        if args[0] == "run":
            with tarfile.open(fileobj=kwargs["stdout"], mode="w") as out:
                out.add(self.data, arcname=".")
            return subprocess.CompletedProcess(args, 0, b"", b"")
        raise AssertionError("Unexpected Docker command: " + repr(args))

    def export(self):
        args = type("Args", (), {
            "output": str(self.bundle), "state": str(self.state),
            "workspace": str(self.workspace), "source": str(self.data),
            "image": "ghcr.io/example/dsh:latest", "name": "dsh"
        })()
        with mock.patch.object(backup, "docker", self.fake_docker), \
             mock.patch.dict(os.environ, {
                 "DSH_NAME": "dsh", "DSH_EDITION": "standard",
                 "DSH_PORT": "3080", "DEEPSEEK_API_KEY": "sensitive-backup-key",
                 "DSH_DOCKER_ACCESS": "true",
             }):
            backup.export_bundle(args)
        self.assertEqual(self.bundle.stat().st_mode & 0o777, 0o600)

    def import_args(self, suffix="new"):
        root = self.base / suffix
        return type("Args", (), {
            "archive": str(self.bundle), "instance": suffix,
            "state": str(self.base / "instances" / suffix),
            "data": str(root / "data"),
            "workspace": str(root / "workspace"), "instance_root": str(root),
            "port": 3083, "dashboard_port": 9083,
        })()

    def test_complete_export_verify_import(self):
        self.export()
        backup.validate_backup(type("Args", (), {"archive": str(self.bundle)})())
        args = self.import_args()
        backup.restore_bundle(args)
        state = Path(args.state)
        self.assertEqual((Path(args.data) / "session.json").read_text(), "secret-session")
        self.assertEqual((Path(args.workspace) / "project.txt").read_text(), "project source")
        self.assertEqual((state / "proxy" / "config.json").read_text(), '{"tag":"proxy"}')
        self.assertEqual((state / "container.env").read_text(), "CUSTOM_FLAG=1\n")
        self.assertFalse((state / "backups").exists(), "backups must not recursively copy")
        conf = (state / "config.env").read_text()
        self.assertIn("DEEPSEEK_API_KEY=sensitive-backup-key", conf)
        self.assertIn("DSH_DOCKER_ACCESS=false", conf)
        self.assertIn(self.digest, conf)
        self.assertIn("DSH_PORT=3083", conf)
        self.assertIn("DSHD_INSTANCE_ID=new", conf)
        mounts = (state / "mounts.conf").read_text()
        self.assertIn("|/root/.config/custom|ro", mounts)
        path = Path(mounts.split("|")[0])
        self.assertEqual((path / "tool.conf").read_text(), "custom config")
        self.assertFalse(str(self.mount) in mounts, "old absolute mount paths must be rewritten")

    def test_existing_instance_is_never_overwritten(self):
        self.export()
        args = self.import_args()
        Path(args.state).mkdir(parents=True)
        (Path(args.state) / "sentinel").write_text("keep")
        with self.assertRaisesRegex(ValueError, "已存在"):
            backup.restore_bundle(args)
        self.assertEqual((Path(args.state) / "sentinel").read_text(), "keep")

    def test_tampered_outer_payload_is_rejected(self):
        self.export()
        tampered = self.base / "tampered.dshbak"
        with tarfile.open(self.bundle, "r:gz") as original, \
             tarfile.open(tampered, "w:gz") as altered:
            for member in original:
                body = original.extractfile(member).read()
                if member.name == "data.tar":
                    body += b"TAMPER"
                header = tarfile.TarInfo(member.name)
                header.size = len(body)
                altered.addfile(header, io.BytesIO(body))
        with self.assertRaisesRegex(ValueError, "长度不匹配"):
            backup.validate_backup(type("Args", (), {"archive": str(tampered)})())

    def test_path_traversal_and_symlink_escape_rejected(self):
        for name in ("../escape", "/etc/passwd"):
            path = self.base / ("bad-" + str(len(name)) + ".tar")
            with tarfile.open(path, "w") as tar:
                item = tarfile.TarInfo(name)
                item.size = 1
                tar.addfile(item, io.BytesIO(b"X"))
            with self.assertRaisesRegex(ValueError, "绝对路径|路径穿越"):
                backup.safe_tar_members(path)
        path = self.base / "badlink.tar"
        with tarfile.open(path, "w") as tar:
            link = tarfile.TarInfo("link")
            link.type = tarfile.SYMTYPE
            link.linkname = "../../etc"
            tar.addfile(link)
            inner = tarfile.TarInfo("link/evil")
            inner.size = 1
            tar.addfile(inner, io.BytesIO(b"X"))
        with self.assertRaisesRegex(ValueError, "软链接"):
            backup.safe_tar_members(path)

    def test_keep_only_automatic_backups(self):
        directory = self.base / "backups"
        directory.mkdir()
        for suffix in ("20260101-000000", "20260102-000000", "20260103-000000"):
            (directory / ("dsh-auto-" + suffix + ".dshbak")).touch()
        (directory / "dsh-full-20260101-000000.dshbak").touch()
        backup.prune(type("Args", (), {
            "directory": str(directory), "name": "dsh", "keep": 2
        })())
        self.assertEqual(len(list(directory.glob("dsh-auto-*.dshbak"))), 2)
        self.assertTrue((directory / "dsh-full-20260101-000000.dshbak").exists())


if __name__ == "__main__":
    unittest.main()
