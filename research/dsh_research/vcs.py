"""Version-control state used by reproducibility manifests."""

from __future__ import annotations

import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class GitState:
    available: bool
    commit: str | None
    branch: str | None
    dirty: bool | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def git_state(root: str | Path) -> GitState:
    """Return a non-throwing snapshot of Git state for *root*."""

    path = Path(root).resolve()
    inside = _git(path, "rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return GitState(False, None, None, None)

    commit_result = _git(path, "rev-parse", "HEAD")
    branch_result = _git(path, "symbolic-ref", "--short", "-q", "HEAD")
    status_result = _git(path, "status", "--porcelain")

    commit = commit_result.stdout.strip() if commit_result.returncode == 0 else None
    branch = branch_result.stdout.strip() if branch_result.returncode == 0 else None
    dirty = None if status_result.returncode != 0 else bool(status_result.stdout.strip())

    return GitState(True, commit or None, branch or None, dirty)
