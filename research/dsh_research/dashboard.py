"""Read-only local dashboard server for DSH Research.

The dashboard deliberately consumes Stable JSON API v1 by invoking the public
research-* CLI commands. It does not import ProjectState, Dataset, Pipeline,
Result, or Check internals and owns no persistent research state.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

DASHBOARD_API_VERSION = 1
JSON_API_NAME = "dsh-research"
JSON_API_VERSION = 1
ASSET_ROOT = Path(__file__).resolve().with_name("dashboard_assets")


class DashboardError(RuntimeError):
    """Raised when the dashboard cannot discover or query a Research Project."""


def discover_project_root(start: str | Path | None = None) -> Path:
    current = Path(start or os.getcwd()).expanduser().resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / "research.yaml").is_file():
            return candidate
    raise DashboardError(f"未找到 Research Project（从 {current} 向上搜索 research.yaml）。")


def is_loopback_host(host: str) -> bool:
    return host.strip().lower() in {"127.0.0.1", "::1", "localhost"}


def _dashboard_error(
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "api": {
            "name": "dsh-research-dashboard",
            "version": DASHBOARD_API_VERSION,
        },
        "ok": False,
        "data": {},
        "error": {
            "code": code,
            "message": message,
            **({"details": details} if details else {}),
        },
    }


class ResearchCliClient:
    """Invoke allow-listed public CLI JSON endpoints and validate their envelope."""

    COMMANDS = {
        "research-status",
        "research-check",
        "research-data",
        "research-pipeline",
        "research-result",
    }

    def __init__(
        self,
        project_root: Path,
        *,
        source_bin_dir: Path | None = None,
    ) -> None:
        self.project_root = project_root.resolve()
        default_bin = Path(__file__).resolve().parents[1] / "bin"
        self.source_bin_dir = (source_bin_dir or default_bin).resolve()

    def _argv(self, command: str) -> list[str]:
        if command not in self.COMMANDS:
            raise DashboardError(f"Dashboard 不允许调用命令: {command}")

        source_script = self.source_bin_dir / command
        if source_script.is_file():
            return [sys.executable, str(source_script)]

        installed = shutil.which(command)
        if installed:
            return [installed]

        raise DashboardError(f"找不到 Research CLI: {command}")

    def invoke(self, command: str, args: list[str]) -> tuple[dict[str, Any], int]:
        argv = [*self._argv(command), *args]
        env = os.environ.copy()

        package_root = Path(__file__).resolve().parents[1]
        current_pythonpath = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            str(package_root)
            if not current_pythonpath
            else str(package_root) + os.pathsep + current_pythonpath
        )

        completed = subprocess.run(
            argv,
            cwd=self.project_root,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )

        stdout = completed.stdout.strip()
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            return (
                _dashboard_error(
                    code="UPSTREAM_INVALID_JSON",
                    message=f"{command} 未返回合法 Stable JSON API 响应。",
                    details={
                        "exit_code": completed.returncode,
                        "stdout": stdout[:1000],
                        "stderr": completed.stderr.strip()[:1000],
                    },
                ),
                HTTPStatus.BAD_GATEWAY,
            )

        api = payload.get("api") if isinstance(payload, dict) else None
        if (
            not isinstance(api, dict)
            or api.get("name") != JSON_API_NAME
            or api.get("version") != JSON_API_VERSION
        ):
            return (
                _dashboard_error(
                    code="UPSTREAM_API_MISMATCH",
                    message=f"{command} 返回的 JSON API 版本与 Dashboard 不兼容。",
                    details={
                        "expected": {"name": JSON_API_NAME, "version": JSON_API_VERSION},
                        "actual": api,
                    },
                ),
                HTTPStatus.BAD_GATEWAY,
            )

        # Domain failures intentionally remain HTTP 200. The JSON API ok/error
        # fields carry semantic state and are useful dashboard content.
        return payload, HTTPStatus.OK


class DashboardRequestHandler(BaseHTTPRequestHandler):
    server_version = "DSHResearchDashboard/1"

    @property
    def dashboard_server(self) -> "ResearchDashboardServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, format: str, *args: Any) -> None:
        if self.dashboard_server.quiet:
            return
        super().log_message(format, *args)

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "frame-ancestors 'none'; "
            "base-uri 'none'; "
            "form-action 'none'",
        )

    def _send_bytes(
        self,
        body: bytes,
        *,
        content_type: str,
        status: int = HTTPStatus.OK,
        cache_control: str = "no-store",
    ) -> None:
        self.send_response(int(status))
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self._security_headers()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._send_bytes(
            body,
            content_type="application/json; charset=utf-8",
            status=status,
        )

    def _send_asset(self, name: str, content_type: str) -> None:
        path = ASSET_ROOT / name
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self._send_bytes(
            path.read_bytes(),
            content_type=content_type,
            cache_control="no-cache",
        )

    @staticmethod
    def _one(query: dict[str, list[str]], key: str) -> str:
        values = query.get(key) or []
        return values[0].strip() if values else ""

    def _api(self, path: str, query: dict[str, list[str]]) -> None:
        client = self.dashboard_server.client

        if path == "/api/meta":
            self._send_json({
                "api": {
                    "name": "dsh-research-dashboard",
                    "version": DASHBOARD_API_VERSION,
                },
                "ok": True,
                "data": {
                    "readonly": True,
                    "research_api": {
                        "name": JSON_API_NAME,
                        "version": JSON_API_VERSION,
                    },
                    "project_root": str(client.project_root),
                },
                "error": None,
            })
            return

        command: str
        args: list[str]

        if path == "/api/status":
            command, args = "research-status", ["--json"]
        elif path == "/api/check":
            mode = self._one(query, "mode") or "full"
            if mode not in {"quick", "full", "release"}:
                self._send_json(
                    _dashboard_error(
                        code="INVALID_ARGUMENT",
                        message="check mode 必须是 quick/full/release。",
                    ),
                    HTTPStatus.BAD_REQUEST,
                )
                return
            args = ["--json"] if mode == "full" else [f"--{mode}", "--json"]
            command = "research-check"
        elif path == "/api/data":
            command, args = "research-data", ["list", "--json"]
        elif path == "/api/dataset":
            dataset_id = self._one(query, "id")
            if not dataset_id:
                self._send_json(
                    _dashboard_error(code="INVALID_ARGUMENT", message="缺少 dataset id。"),
                    HTTPStatus.BAD_REQUEST,
                )
                return
            command, args = "research-data", ["show", dataset_id, "--json"]
        elif path == "/api/lineage":
            dataset_id = self._one(query, "id")
            if not dataset_id:
                self._send_json(
                    _dashboard_error(code="INVALID_ARGUMENT", message="缺少 dataset id。"),
                    HTTPStatus.BAD_REQUEST,
                )
                return
            command, args = "research-data", ["lineage", dataset_id, "--json"]
        elif path == "/api/pipeline":
            command, args = "research-pipeline", ["status", "--json"]
        elif path == "/api/pipeline-step":
            step = self._one(query, "step")
            if not step:
                self._send_json(
                    _dashboard_error(code="INVALID_ARGUMENT", message="缺少 pipeline step。"),
                    HTTPStatus.BAD_REQUEST,
                )
                return
            command, args = "research-pipeline", ["explain", step, "--json"]
        elif path == "/api/results":
            command, args = "research-result", ["list", "--json"]
        elif path == "/api/result":
            result_id = self._one(query, "id")
            if not result_id:
                self._send_json(
                    _dashboard_error(code="INVALID_ARGUMENT", message="缺少 result id。"),
                    HTTPStatus.BAD_REQUEST,
                )
                return
            command, args = "research-result", ["show", result_id, "--json"]
        else:
            self._send_json(
                _dashboard_error(code="NOT_FOUND", message=f"未知 Dashboard API: {path}"),
                HTTPStatus.NOT_FOUND,
            )
            return

        payload, status = client.invoke(command, args)
        self._send_json(payload, status)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)

        if path.startswith("/api/"):
            self._api(path, query)
            return
        if path in {"/", "/index.html"}:
            self._send_asset("index.html", "text/html; charset=utf-8")
            return
        if path == "/assets/app.css":
            self._send_asset("app.css", "text/css; charset=utf-8")
            return
        if path == "/assets/app.js":
            self._send_asset("app.js", "text/javascript; charset=utf-8")
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def _method_not_allowed(self) -> None:
        self._send_json(
            _dashboard_error(
                code="METHOD_NOT_ALLOWED",
                message="Research Dashboard V2.0 是只读界面，仅允许 GET/HEAD。",
            ),
            HTTPStatus.METHOD_NOT_ALLOWED,
        )

    do_POST = _method_not_allowed
    do_PUT = _method_not_allowed
    do_PATCH = _method_not_allowed
    do_DELETE = _method_not_allowed


class ResearchDashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int],
        client: ResearchCliClient,
        *,
        quiet: bool = False,
    ) -> None:
        self.client = client
        self.quiet = quiet
        super().__init__(server_address, DashboardRequestHandler)


class ResearchDashboardIPv6Server(ResearchDashboardServer):
    address_family = socket.AF_INET6


def make_server(
    project_root: Path,
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    quiet: bool = False,
    source_bin_dir: Path | None = None,
) -> ResearchDashboardServer:
    client = ResearchCliClient(project_root, source_bin_dir=source_bin_dir)
    server_cls = ResearchDashboardIPv6Server if ":" in host else ResearchDashboardServer
    return server_cls((host, port), client, quiet=quiet)
