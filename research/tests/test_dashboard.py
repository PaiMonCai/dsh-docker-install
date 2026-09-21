from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from dsh_research.dashboard import (
    DashboardError,
    ResearchCliClient,
    discover_project_root,
    is_loopback_host,
    make_server,
)


class DashboardTests(unittest.TestCase):
    def make_project(self, root: Path) -> Path:
        (root / "research.yaml").write_text(
            "schema: 2\n"
            "project:\n"
            "  slug: dashboard-test\n"
            "  title: Dashboard Test\n"
            "  template: default\n"
            "  status: active\n"
            "research:\n"
            "  field: economics\n"
            "  question: Does X affect Y?\n"
            "  hypotheses: []\n",
            encoding="utf-8",
        )
        (root / "pipeline.yaml").write_text(
            "schema: 1\nsteps: {}\n",
            encoding="utf-8",
        )
        return root.resolve()

    def test_discover_project_root_and_loopback_policy(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = self.make_project(Path(td))
            nested = root / "src" / "nested"
            nested.mkdir(parents=True)
            self.assertEqual(discover_project_root(nested), root)
        self.assertTrue(is_loopback_host("127.0.0.1"))
        self.assertTrue(is_loopback_host("localhost"))
        self.assertTrue(is_loopback_host("::1"))
        self.assertFalse(is_loopback_host("0.0.0.0"))

    def test_cli_client_only_allows_public_read_apis(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = self.make_project(Path(td))
            client = ResearchCliClient(root)
            payload, http_status = client.invoke("research-status", ["--json"])
            self.assertEqual(http_status, 200)
            self.assertEqual(payload["api"], {"name": "dsh-research", "version": 1})
            self.assertEqual(payload["command"], "research-status")
            self.assertEqual(payload["data"]["project"]["title"], "Dashboard Test")
            with self.assertRaises(DashboardError):
                client.invoke("research-run", ["--json"])

    def test_http_server_serves_ui_and_stable_api(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = self.make_project(Path(td))
            server = make_server(root, port=0, quiet=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            host, port = server.server_address[:2]
            base = f"http://{host}:{port}"
            try:
                with urllib.request.urlopen(base + "/", timeout=5) as response:
                    html = response.read().decode("utf-8")
                    csp = response.headers.get("Content-Security-Policy")
                self.assertIn("DSH Research Dashboard", html)
                self.assertIn("Overview", html)
                self.assertIn("default-src 'self'", csp or "")

                with urllib.request.urlopen(base + "/assets/app.css", timeout=5) as response:
                    css = response.read().decode("utf-8")
                self.assertIn("--surface", css)

                with urllib.request.urlopen(base + "/api/meta", timeout=5) as response:
                    meta = json.loads(response.read().decode("utf-8"))
                self.assertTrue(meta["ok"])
                self.assertTrue(meta["data"]["readonly"])
                self.assertEqual(meta["data"]["research_api"]["version"], 1)

                with urllib.request.urlopen(base + "/api/status", timeout=5) as response:
                    status = json.loads(response.read().decode("utf-8"))
                self.assertEqual(status["command"], "research-status")
                self.assertEqual(status["operation"], "status")
                self.assertEqual(status["data"]["project"]["slug"], "dashboard-test")

                request = urllib.request.Request(
                    base + "/api/status",
                    data=b"{}",
                    method="POST",
                    headers={"Content-Type": "application/json"},
                )
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request, timeout=5)
                self.assertEqual(caught.exception.code, 405)
                body = json.loads(caught.exception.read().decode("utf-8"))
                self.assertEqual(body["error"]["code"], "METHOD_NOT_ALLOWED")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_invalid_api_arguments_are_structured(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = self.make_project(Path(td))
            server = make_server(root, port=0, quiet=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            host, port = server.server_address[:2]
            try:
                url = f"http://{host}:{port}/api/check?mode=unknown"
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(url, timeout=5)
                self.assertEqual(caught.exception.code, 400)
                body = json.loads(caught.exception.read().decode("utf-8"))
                self.assertEqual(body["error"]["code"], "INVALID_ARGUMENT")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
