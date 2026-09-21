"""Dataset Catalog and lineage primitives for DSH Research."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .config import load_yaml, write_yaml
from .errors import ManifestError
from .hashing import sha256_file
from .project import ResearchProject

DATASET_SCHEMA = 1
DATASET_KINDS = {"raw", "processed", "interim", "external"}
_DATASET_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True, slots=True)
class DatasetStatus:
    dataset_id: str
    status: str
    path: str | None
    expected_sha256: str | None
    current_sha256: str | None
    message: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_dataset_id(value: str) -> str:
    value = value.strip()
    if not _DATASET_ID_RE.fullmatch(value):
        raise ManifestError(
            "dataset id 只能包含字母、数字、点、下划线和短横线，且必须以字母或数字开头。"
        )
    return value


def catalog_dir(project: ResearchProject) -> Path:
    return project.root / "data" / "catalog"


def manifest_path(project: ResearchProject, dataset_id: str) -> Path:
    return catalog_dir(project) / f"{validate_dataset_id(dataset_id)}.yaml"


def _relative_project_path(project: ResearchProject, value: str | Path) -> tuple[Path, str]:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = project.root / candidate
    resolved = candidate.resolve()
    try:
        relative = resolved.relative_to(project.root.resolve()).as_posix()
    except ValueError as exc:
        raise ManifestError(f"Dataset 必须位于 Research Project 内: {resolved}") from exc
    return resolved, relative


def infer_format(path: Path) -> str:
    suffix = path.suffix.lower()
    mapping = {
        ".csv": "csv",
        ".tsv": "tsv",
        ".parquet": "parquet",
        ".pq": "parquet",
        ".feather": "feather",
        ".arrow": "arrow",
        ".json": "json",
        ".jsonl": "jsonl",
        ".ndjson": "jsonl",
        ".xlsx": "xlsx",
        ".xls": "xls",
        ".dta": "stata",
        ".sav": "spss",
    }
    return mapping.get(suffix, suffix.lstrip(".") or "binary")


def inspect_dimensions(path: Path, fmt: str) -> dict[str, Any]:
    """Collect inexpensive shape/schema metadata where practical."""

    try:
        if fmt in {"csv", "tsv"}:
            delimiter = "," if fmt == "csv" else "\t"
            with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as handle:
                reader = csv.reader(handle, delimiter=delimiter)
                header = next(reader, [])
                rows = sum(1 for _ in reader)
            return {
                "rows": rows,
                "columns": len(header),
                "column_names": [str(x) for x in header],
            }

        if fmt == "parquet":
            import pyarrow.parquet as pq

            metadata = pq.ParquetFile(path).metadata
            schema = pq.read_schema(path)
            return {
                "rows": int(metadata.num_rows),
                "columns": int(metadata.num_columns),
                "column_names": list(schema.names),
                "column_types": {field.name: str(field.type) for field in schema},
            }

        if fmt in {"feather", "arrow"}:
            import pyarrow.feather as feather

            table = feather.read_table(path, memory_map=True)
            return {
                "rows": int(table.num_rows),
                "columns": int(table.num_columns),
                "column_names": list(table.column_names),
                "column_types": {field.name: str(field.type) for field in table.schema},
            }

        if fmt == "jsonl":
            rows = 0
            names: list[str] = []
            seen: set[str] = set()
            with path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    rows += 1
                    if rows <= 100:
                        try:
                            value = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(value, dict):
                            for key in value:
                                key = str(key)
                                if key not in seen:
                                    seen.add(key)
                                    names.append(key)
            return {"rows": rows, "columns": len(names) if names else None, "column_names": names}

    except Exception as exc:
        return {"inspection_warning": f"{type(exc).__name__}: {exc}"}

    return {}


def load_dataset_manifest(project: ResearchProject, dataset_id: str) -> dict[str, Any]:
    path = manifest_path(project, dataset_id)
    if not path.is_file():
        raise ManifestError(f"Dataset manifest 不存在: {dataset_id}")
    data = load_yaml(path)
    validate_dataset_manifest(data, expected_id=dataset_id)
    return data


def validate_dataset_manifest(
    data: dict[str, Any], *, expected_id: str | None = None
) -> dict[str, Any]:
    if data.get("schema") != DATASET_SCHEMA:
        raise ManifestError(
            f"不支持的 Dataset manifest schema: {data.get('schema')!r}"
        )
    dataset = data.get("dataset")
    if not isinstance(dataset, dict):
        raise ManifestError("Dataset manifest 缺少 dataset mapping。")
    dataset_id = validate_dataset_id(str(dataset.get("id") or ""))
    if expected_id is not None and dataset_id != validate_dataset_id(expected_id):
        raise ManifestError(
            f"Dataset manifest id={dataset_id} 与文件名 {expected_id} 不一致。"
        )
    kind = str(data.get("kind") or "")
    if kind not in DATASET_KINDS:
        raise ManifestError(f"未知 dataset kind: {kind!r}")
    path_value = data.get("path")
    if not isinstance(path_value, str) or not path_value.strip():
        raise ManifestError("Dataset manifest 缺少 path。")
    fingerprint = data.get("fingerprint")
    if not isinstance(fingerprint, dict) or not fingerprint.get("sha256"):
        raise ManifestError("Dataset manifest 缺少 fingerprint.sha256。")
    lineage = data.get("lineage")
    if lineage is not None and not isinstance(lineage, dict):
        raise ManifestError("Dataset lineage 必须是 mapping。")
    return data


def list_dataset_ids(project: ResearchProject) -> list[str]:
    root = catalog_dir(project)
    if not root.is_dir():
        return []
    return sorted(path.stem for path in root.glob("*.yaml") if path.is_file())


def dataset_status(project: ResearchProject, dataset_id: str) -> DatasetStatus:
    dataset_id = validate_dataset_id(dataset_id)
    path = manifest_path(project, dataset_id)
    if not path.is_file():
        return DatasetStatus(dataset_id, "invalid", None, None, None, "manifest missing")

    try:
        data = load_yaml(path)
        validate_dataset_manifest(data, expected_id=dataset_id)
        data_path, relative = _relative_project_path(project, str(data["path"]))
        expected = str(data["fingerprint"]["sha256"])
    except Exception as exc:
        return DatasetStatus(
            dataset_id, "invalid", None, None, None,
            f"{type(exc).__name__}: {exc}",
        )

    if not data_path.is_file():
        return DatasetStatus(
            dataset_id, "missing", relative, expected, None, "dataset file missing"
        )

    current = sha256_file(data_path)
    if current != expected:
        return DatasetStatus(
            dataset_id, "stale", relative, expected, current, "dataset SHA256 changed"
        )
    return DatasetStatus(
        dataset_id, "current", relative, expected, current, "dataset matches manifest"
    )


def all_dataset_statuses(project: ResearchProject) -> list[DatasetStatus]:
    return [dataset_status(project, dataset_id) for dataset_id in list_dataset_ids(project)]


def register_dataset(
    project: ResearchProject,
    *,
    dataset_id: str,
    path: str | Path,
    kind: str,
    title: str = "",
    source: str = "",
    license_name: str = "",
    distributable: bool | None = None,
    inputs: Iterable[str] = (),
    pipeline_step: str = "",
    run_id: str = "",
    force: bool = False,
) -> Path:
    dataset_id = validate_dataset_id(dataset_id)
    kind = kind.strip().lower()
    if kind not in DATASET_KINDS:
        raise ManifestError(
            f"--kind 必须是: {', '.join(sorted(DATASET_KINDS))}"
        )

    data_path, relative = _relative_project_path(project, path)
    if not data_path.is_file():
        raise ManifestError(f"Dataset 文件不存在: {data_path}")

    target = manifest_path(project, dataset_id)
    if target.exists() and not force:
        raise ManifestError(
            f"Dataset 已登记: {dataset_id}；如需更新 manifest，请显式使用 --force。"
        )

    input_ids = [validate_dataset_id(value) for value in inputs]
    if dataset_id in input_ids:
        raise ManifestError("Dataset 不能把自己作为 lineage input。")

    fmt = infer_format(data_path)
    dimensions = inspect_dimensions(data_path, fmt)
    access: dict[str, Any] = {}
    if license_name:
        access["license"] = license_name
    if distributable is not None:
        access["distributable"] = distributable

    manifest: dict[str, Any] = {
        "schema": DATASET_SCHEMA,
        "dataset": {
            "id": dataset_id,
            "title": title.strip() or dataset_id,
        },
        "kind": kind,
        "path": relative,
        "format": fmt,
        "fingerprint": {
            "sha256": sha256_file(data_path),
            "size": data_path.stat().st_size,
        },
        "dimensions": dimensions,
        "lineage": {
            "inputs": [{"dataset": value} for value in input_ids],
            "pipeline_step": pipeline_step.strip() or None,
            "run_id": run_id.strip() or None,
        },
        "source": {
            "description": source.strip() or None,
        },
        "access": access,
    }
    write_yaml(target, manifest)
    return target


def verify_catalog(project: ResearchProject) -> list[DatasetStatus]:
    """Return DatasetStatus objects; status != current represents a failure."""

    statuses = all_dataset_statuses(project)
    ids = set(list_dataset_ids(project))
    rewritten: list[DatasetStatus] = []
    for status in statuses:
        if status.status != "current":
            rewritten.append(status)
            continue
        try:
            data = load_dataset_manifest(project, status.dataset_id)
            lineage = data.get("lineage") if isinstance(data.get("lineage"), dict) else {}
            refs = lineage.get("inputs") if isinstance(lineage.get("inputs"), list) else []
            missing = []
            for ref in refs:
                if not isinstance(ref, dict):
                    missing.append("<invalid>")
                    continue
                dep = str(ref.get("dataset") or "")
                if dep not in ids:
                    missing.append(dep or "<empty>")
            if missing:
                rewritten.append(
                    DatasetStatus(
                        status.dataset_id,
                        "invalid",
                        status.path,
                        status.expected_sha256,
                        status.current_sha256,
                        "missing lineage dataset(s): " + ", ".join(missing),
                    )
                )
            else:
                rewritten.append(status)
        except Exception as exc:
            rewritten.append(
                DatasetStatus(
                    status.dataset_id,
                    "invalid",
                    status.path,
                    status.expected_sha256,
                    status.current_sha256,
                    f"{type(exc).__name__}: {exc}",
                )
            )
    return rewritten


def lineage_tree(project: ResearchProject, dataset_id: str) -> dict[str, Any]:
    dataset_id = validate_dataset_id(dataset_id)
    seen_stack: list[str] = []

    def visit(current: str) -> dict[str, Any]:
        if current in seen_stack:
            cycle = seen_stack[seen_stack.index(current):] + [current]
            return {"dataset": current, "status": "cycle", "cycle": cycle, "inputs": []}
        if current not in set(list_dataset_ids(project)):
            return {"dataset": current, "status": "missing", "inputs": []}

        seen_stack.append(current)
        status = dataset_status(project, current)
        data = load_dataset_manifest(project, current)
        lineage = data.get("lineage") if isinstance(data.get("lineage"), dict) else {}
        refs = lineage.get("inputs") if isinstance(lineage.get("inputs"), list) else []
        children = []
        for ref in refs:
            if isinstance(ref, dict) and ref.get("dataset"):
                children.append(visit(str(ref["dataset"])))
        seen_stack.pop()
        return {
            "dataset": current,
            "status": status.status,
            "path": status.path,
            "pipeline_step": lineage.get("pipeline_step"),
            "run_id": lineage.get("run_id"),
            "inputs": children,
        }

    return visit(dataset_id)


def render_lineage(node: dict[str, Any], *, prefix: str = "", last: bool = True) -> str:
    connector = "└── " if last else "├── "
    if not prefix:
        head = f"{node.get('dataset')} [{node.get('status')}]"
    else:
        head = prefix + connector + f"{node.get('dataset')} [{node.get('status')}]"
    lines = [head]
    children = node.get("inputs") if isinstance(node.get("inputs"), list) else []
    child_prefix = prefix + ("    " if last else "│   ")
    if not prefix:
        child_prefix = ""
    for index, child in enumerate(children):
        nested_prefix = "    " if not prefix else child_prefix
        lines.append(
            render_lineage(
                child,
                prefix=nested_prefix,
                last=index == len(children) - 1,
            )
        )
    return "\n".join(lines)
