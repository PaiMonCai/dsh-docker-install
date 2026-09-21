"""YAML configuration helpers for Research projects."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import yaml

from .errors import InvalidConfigError
from .files import atomic_write_text
from .project import ResearchProject


def load_yaml(path: str | Path) -> dict[str, Any]:
    """Load a YAML document and require a mapping at the top level."""

    source = Path(path)
    with source.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)

    if value is None:
        return {}
    if not isinstance(value, dict):
        raise InvalidConfigError(f"YAML 顶层必须是 mapping: {source}")
    return value


def write_yaml(path: str | Path, payload: Mapping[str, Any]) -> Path:
    """Write a mapping as deterministic UTF-8 YAML using an atomic replace."""

    if not isinstance(payload, Mapping):
        raise InvalidConfigError("YAML payload 顶层必须是 mapping。")
    text = yaml.safe_dump(
        dict(payload),
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )
    return atomic_write_text(path, text)


def load_research_config(
    project: ResearchProject | str | Path | None = None,
) -> dict[str, Any]:
    """Load `research.yaml` from a project object, root path, or discovery."""

    if isinstance(project, ResearchProject):
        resolved = project
    elif project is None:
        resolved = ResearchProject.discover()
    else:
        candidate = Path(project)
        if candidate.is_file() and candidate.name == "research.yaml":
            return load_yaml(candidate)
        resolved = ResearchProject.discover(candidate)

    return load_yaml(resolved.config_path)
