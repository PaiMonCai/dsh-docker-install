"""Research Project discovery and identity."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import ProjectNotFoundError


PROJECT_MARKER = "research.yaml"


def find_project_root(start: str | Path | None = None) -> Path:
    """Return the nearest ancestor containing `research.yaml`.

    Discovery deliberately mirrors the existing V1 CLI behavior: start from
    the current directory (or the supplied path) and walk upward until the
    filesystem root.
    """

    current = Path(start or Path.cwd()).expanduser()
    if current.exists() and current.is_file():
        current = current.parent
    current = current.resolve()

    while True:
        if (current / PROJECT_MARKER).is_file():
            return current
        if current.parent == current:
            break
        current = current.parent

    raise ProjectNotFoundError(
        f"未找到 {PROJECT_MARKER}；请在 Research Project 内运行。"
    )


@dataclass(frozen=True, slots=True)
class ResearchProject:
    """Stable identity for a Research Project on disk."""

    root: Path

    @classmethod
    def discover(cls, start: str | Path | None = None) -> "ResearchProject":
        return cls(find_project_root(start))

    @property
    def config_path(self) -> Path:
        return self.root / PROJECT_MARKER

    def path(self, *parts: str) -> Path:
        return self.root.joinpath(*parts)
