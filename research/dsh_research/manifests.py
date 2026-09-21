"""JSON and JSONL manifest I/O with stable serialization."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from .errors import ManifestError
from .files import atomic_write_text


def load_json(path: str | Path) -> dict[str, Any]:
    source = Path(path)
    try:
        with source.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"无法读取 JSON manifest: {source}: {exc}") from exc

    if not isinstance(value, dict):
        raise ManifestError(f"JSON manifest 顶层必须是 object: {source}")
    return value


def write_json(path: str | Path, payload: Mapping[str, Any]) -> Path:
    if not isinstance(payload, Mapping):
        raise ManifestError("JSON manifest 顶层必须是 object。")
    text = json.dumps(
        dict(payload),
        ensure_ascii=False,
        indent=2,
        sort_keys=False,
    ) + "\n"
    return atomic_write_text(path, text)


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    source = Path(path)
    rows: list[dict[str, Any]] = []
    try:
        with source.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ManifestError(
                        f"JSONL 每行必须是 object: {source}:{line_number}"
                    )
                rows.append(value)
    except json.JSONDecodeError as exc:
        raise ManifestError(f"无效 JSONL: {source}:{exc.lineno}: {exc.msg}") from exc
    except OSError as exc:
        raise ManifestError(f"无法读取 JSONL: {source}: {exc}") from exc
    return rows


def write_jsonl(path: str | Path, rows: Iterable[Mapping[str, Any]]) -> Path:
    lines: list[str] = []
    for row in rows:
        if not isinstance(row, Mapping):
            raise ManifestError("JSONL row 必须是 object。")
        lines.append(json.dumps(dict(row), ensure_ascii=False, sort_keys=False))
    text = "\n".join(lines)
    if lines:
        text += "\n"
    return atomic_write_text(path, text)
