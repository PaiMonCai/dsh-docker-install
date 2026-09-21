"""Research project schema validation and explicit migrations."""

from __future__ import annotations

import copy
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .config import load_yaml, write_yaml
from .errors import InvalidConfigError
from .project import ResearchProject

CURRENT_PROJECT_SCHEMA = 2
SUPPORTED_PROJECT_SCHEMAS = {1, 2}


def project_schema(config: dict[str, Any]) -> int:
    value = config.get("schema", 1)
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidConfigError("research.yaml 的 schema 必须是整数。")
    return value


def validate_project_schema(config: dict[str, Any]) -> int:
    schema = project_schema(config)
    if schema not in SUPPORTED_PROJECT_SCHEMAS:
        if schema > CURRENT_PROJECT_SCHEMA:
            raise InvalidConfigError(
                f"项目 schema={schema} 高于当前支持的 {CURRENT_PROJECT_SCHEMA}；请升级 DSH Research。"
            )
        raise InvalidConfigError(f"不支持的 research.yaml schema: {schema}")
    return schema


def infer_template(config: dict[str, Any]) -> str:
    project = config.get("project")
    if isinstance(project, dict) and project.get("template"):
        return str(project["template"])
    if isinstance(config.get("economics"), dict):
        return "economics"
    research = config.get("research")
    if isinstance(research, dict) and research.get("field") == "economics":
        return "economics"
    return "default"


def migrate_config(config: dict[str, Any], target: int = CURRENT_PROJECT_SCHEMA) -> dict[str, Any]:
    """Return a migrated copy without mutating the caller's object."""

    current = validate_project_schema(config)
    if target not in SUPPORTED_PROJECT_SCHEMAS:
        raise InvalidConfigError(f"不支持的迁移目标 schema: {target}")
    if target < current:
        raise InvalidConfigError(f"不支持 schema 降级: {current} -> {target}")

    result = copy.deepcopy(config)
    if current == target:
        return result

    if current == 1 and target >= 2:
        project = result.setdefault("project", {})
        if not isinstance(project, dict):
            raise InvalidConfigError("research.yaml project 必须是 mapping。")
        project.setdefault("template", infer_template(result))
        project.setdefault("status", "active")
        result["schema"] = 2
        current = 2

    if current != target:
        raise InvalidConfigError(f"无法迁移 schema: {project_schema(config)} -> {target}")
    return result


def migrate_project(
    project: ResearchProject,
    *,
    target: int = CURRENT_PROJECT_SCHEMA,
) -> tuple[int, int, Path | None]:
    """Migrate research.yaml in place after creating a one-time schema backup."""

    config = load_yaml(project.config_path)
    before = validate_project_schema(config)
    if before == target:
        return before, before, None

    migrated = migrate_config(config, target)
    backup = project.config_path.with_name(f"research.yaml.bak.schema{before}")
    if not backup.exists():
        shutil.copy2(project.config_path, backup)
    _exclude_local_backup(project.root, backup.name)
    write_yaml(project.config_path, migrated)
    return before, target, backup


def _exclude_local_backup(root: Path, backup_name: str) -> None:
    """Keep migration backups local without rewriting the user's .gitignore.

    New templates ignore schema backups globally.  Existing V1 projects may not
    have that rule, so add it to Git's repository-local exclude file when Git is
    available.  Failure is deliberately non-fatal: preserving the backup is
    more important than keeping status output clean.
    """

    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--git-path", "info/exclude"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return
        exclude = Path(result.stdout.strip())
        if not exclude.is_absolute():
            exclude = (root / exclude).resolve()
        exclude.parent.mkdir(parents=True, exist_ok=True)
        pattern = f"/{backup_name}"
        existing = exclude.read_text(encoding="utf-8") if exclude.is_file() else ""
        lines = {line.strip() for line in existing.splitlines()}
        if pattern not in lines:
            with exclude.open("a", encoding="utf-8") as handle:
                if existing and not existing.endswith("\n"):
                    handle.write("\n")
                handle.write(pattern + "\n")
    except OSError:
        return
