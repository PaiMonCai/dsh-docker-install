"""Run Manifest v2 and reusable command execution recorder."""

from __future__ import annotations

import os
import platform
import shlex
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .datasets import list_dataset_ids, verify_catalog
from .errors import ResearchError
from .hashing import sha256_file, tree_digest
from .manifests import write_json
from .project import ResearchProject
from .vcs import git_state

RUN_MANIFEST_SCHEMA = 2


class RunError(ResearchError):
    """Raised when a recorded research run cannot be prepared."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_label(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in value.strip())
    cleaned = cleaned.strip("-")
    return cleaned or "run"


def _run_id(label: str, value: datetime | None = None) -> str:
    dt = value or _now()
    return dt.strftime("%Y%m%dT%H%M%S%fZ") + "-" + _safe_label(label)


def _capture(command: list[str]) -> str | None:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or result.stderr.strip() or None


def _relative(project: ResearchProject, value: str | Path) -> tuple[Path, str]:
    path = Path(value)
    if not path.is_absolute():
        path = project.root / path
    resolved = path.resolve()
    try:
        rel = resolved.relative_to(project.root.resolve()).as_posix()
    except ValueError as exc:
        raise RunError(f"run input/output 必须位于项目内: {resolved}") from exc
    return resolved, rel


def _dataset_snapshots(project: ResearchProject, selected: Iterable[str]) -> list[dict[str, Any]]:
    wanted = list(selected)
    statuses = {item.dataset_id: item for item in verify_catalog(project)}
    if not wanted:
        wanted = list_dataset_ids(project)
    rows: list[dict[str, Any]] = []
    for dataset_id in wanted:
        item = statuses.get(dataset_id)
        if item is None:
            rows.append({"dataset": dataset_id, "status": "missing", "sha256": None, "path": None})
            continue
        rows.append({
            "dataset": dataset_id,
            "status": item.status,
            "sha256": item.current_sha256,
            "path": item.path,
        })
    return rows


def _file_snapshots(project: ResearchProject, values: Iterable[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for value in values:
        path, rel = _relative(project, value)
        if not path.is_file():
            rows.append({"path": rel, "status": "missing", "sha256": None, "size": None})
        else:
            rows.append({
                "path": rel,
                "status": "current",
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            })
    return rows


def _environment() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "python_executable": sys.executable,
        "uv": _capture(["uv", "--version"]),
        "quarto": _capture(["quarto", "--version"]),
        "pandoc": _capture(["pandoc", "--version"]),
        "r": _capture(["R", "--version"]),
        "research_version": os.environ.get("DSH_RESEARCH_VERSION"),
        "research_pack": os.environ.get("DSH_RESEARCH_PACK", "none"),
        "image_digest": os.environ.get("DSH_IMAGE_DIGEST"),
        "platform": platform.platform(),
        "machine": platform.machine(),
    }


def _write_environment_files(run_dir: Path, environment: dict[str, Any]) -> None:
    target = run_dir / "environment"
    target.mkdir(parents=True, exist_ok=True)
    for key in ("python", "uv", "quarto", "pandoc", "r", "image_digest"):
        value = environment.get(key)
        if value:
            (target / f"{key}.txt").write_text(str(value).rstrip() + "\n", encoding="utf-8")

    venv = os.environ.get("DSH_RESEARCH_VENV", "/opt/dsh-research/venv")
    frozen = _capture(["uv", "pip", "freeze", "--python", str(Path(venv) / "bin" / "python")])
    if frozen:
        (target / "pip-freeze.txt").write_text(frozen.rstrip() + "\n", encoding="utf-8")


def _pump(stream, log, target) -> None:
    for chunk in iter(stream.readline, ""):
        if not chunk:
            break
        log.write(chunk)
        log.flush()
        target.write(chunk)
        target.flush()
    stream.close()


@dataclass(frozen=True, slots=True)
class RunResult:
    run_id: str
    run_dir: Path
    manifest_path: Path
    exit_code: int


def record_run(
    project: ResearchProject,
    *,
    label: str,
    command: list[str],
    input_datasets: Iterable[str] = (),
    input_files: Iterable[str] = (),
    output_files: Iterable[str] = (),
) -> RunResult:
    if not command:
        raise RunError("缺少要执行的命令。")

    run_id = _run_id(label)
    run_dir = project.root / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "manifests").mkdir()
    (run_dir / "command.sh").write_text(shlex.join(command) + "\n", encoding="utf-8")

    env_info = _environment()
    _write_environment_files(run_dir, env_info)
    vcs = git_state(project.root)

    inputs = {
        "datasets": _dataset_snapshots(project, input_datasets),
        "files": _file_snapshots(project, input_files),
        "trees": {
            "data/raw": tree_digest(project.root / "data" / "raw"),
            "data/processed": tree_digest(project.root / "data" / "processed"),
        },
    }

    started = _iso()
    with (run_dir / "stdout.log").open("w", encoding="utf-8") as stdout_log, (
        run_dir / "stderr.log"
    ).open("w", encoding="utf-8") as stderr_log:
        try:
            process = subprocess.Popen(
                command,
                cwd=project.root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            exit_code = 127
            stderr_log.write(f"{type(exc).__name__}: {exc}\n")
        else:
            assert process.stdout is not None
            assert process.stderr is not None
            threads = [
                threading.Thread(target=_pump, args=(process.stdout, stdout_log, sys.stdout)),
                threading.Thread(target=_pump, args=(process.stderr, stderr_log, sys.stderr)),
            ]
            for thread in threads:
                thread.start()
            exit_code = int(process.wait())
            for thread in threads:
                thread.join()

    outputs = {
        "files": _file_snapshots(project, output_files),
        "trees": {
            "results": tree_digest(project.root / "results"),
            "paper": tree_digest(project.root / "paper"),
        },
    }
    finished = _iso()
    manifest = {
        "schema": RUN_MANIFEST_SCHEMA,
        "kind": "research-run",
        "id": run_id,
        "label": label,
        "pipeline_step": os.environ.get("DSH_PIPELINE_STEP"),
        "pipeline_run_id": os.environ.get("DSH_PIPELINE_RUN_ID"),
        "command": command,
        "started_at": started,
        "finished_at": finished,
        "inputs": inputs,
        "outputs": outputs,
        "environment": env_info,
        "git": vcs.as_dict(),
        "exit_code": exit_code,
        "success": exit_code == 0,
    }
    manifest_path = write_json(run_dir / "metadata.json", manifest)

    latest = project.root / "runs" / "latest"
    try:
        if latest.is_symlink() or latest.exists():
            latest.unlink()
        latest.symlink_to(run_dir.name)
    except OSError:
        pass

    return RunResult(run_id, run_dir, manifest_path, exit_code)
