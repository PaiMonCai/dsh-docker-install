"""Unified Research Result Registry for DSH Research V2."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .config import load_yaml, write_yaml
from .datasets import verify_catalog
from .errors import ManifestError, ResearchError
from .hashing import sha256_file
from .manifests import load_json
from .project import ResearchProject

RESULT_SCHEMA = 1
_RESULT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_RESULT_TYPE_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


class ResultError(ResearchError):
    """Raised when a Research Result cannot be registered or verified."""


@dataclass(frozen=True, slots=True)
class ResultStatus:
    result_id: str
    result_type: str | None
    status: str
    hash: str | None
    title: str | None
    manifest: str | None
    run: str | None
    artifacts: int
    message: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_result_id(value: str) -> str:
    value = value.strip()
    if not _RESULT_ID_RE.fullmatch(value):
        raise ResultError(
            "result id 只能包含字母、数字、点、下划线和短横线，且必须以字母或数字开头。"
        )
    return value


def validate_result_type(value: str) -> str:
    value = value.strip().lower()
    if not _RESULT_TYPE_RE.fullmatch(value):
        raise ResultError(
            "result type 只能包含小写字母、数字、点、下划线和短横线。"
        )
    return value


def registry_dir(project: ResearchProject) -> Path:
    return project.root / "results" / "registry"


def result_manifest_path(project: ResearchProject, result_id: str) -> Path:
    return registry_dir(project) / f"{validate_result_id(result_id)}.yaml"


def _project_file(
    project: ResearchProject,
    value: str | Path,
    *,
    must_exist: bool = True,
) -> tuple[Path, str]:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project.root / path
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(project.root.resolve()).as_posix()
    except ValueError as exc:
        raise ResultError(f"Result 引用文件必须位于 Research Project 内: {resolved}") from exc
    if must_exist and not resolved.is_file():
        raise ResultError(f"Result 引用文件不存在: {relative}")
    return resolved, relative


def _fingerprint(project: ResearchProject, value: str | Path) -> dict[str, Any]:
    path, relative = _project_file(project, value)
    return {
        "path": relative,
        "sha256": sha256_file(path),
        "size": path.stat().st_size,
    }


def _canonical_hash(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _provenance_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": manifest.get("source"),
        "run": manifest.get("run"),
        "inputs": manifest.get("inputs"),
        "artifacts": manifest.get("artifacts"),
    }


def result_hash(manifest: dict[str, Any]) -> str:
    return _canonical_hash(_provenance_payload(manifest))


def _resolve_run_manifest(
    project: ResearchProject,
    *,
    run_id: str = "",
    run_manifest: str = "",
) -> dict[str, Any] | None:
    if run_id and run_manifest:
        raise ResultError("--run 与 --run-manifest 不能同时使用。")
    path: Path | None = None
    if run_manifest:
        path, _ = _project_file(project, run_manifest)
    elif run_id:
        direct = project.root / "runs" / run_id / "metadata.json"
        if direct.is_file():
            path = direct
        else:
            matches = sorted((project.root / "runs" / "pipeline").glob(f"*/{run_id}/manifest.json"))
            if len(matches) > 1:
                raise ResultError(f"run id 不唯一: {run_id}")
            if matches:
                path = matches[0]
            else:
                raise ResultError(f"Run manifest 不存在: {run_id}")

    if path is None:
        return None
    relative = path.relative_to(project.root).as_posix()
    data = load_json(path)
    resolved_id = str(data.get("id") or data.get("run_id") or run_id or path.parent.name)
    success = data.get("success")
    if success is False:
        raise ResultError(f"不能把失败 run 注册为 Result: {resolved_id}")
    return {
        "id": resolved_id,
        "manifest": relative,
        "sha256": sha256_file(path),
    }


def _dataset_inputs(
    project: ResearchProject,
    dataset_ids: Iterable[str],
) -> list[dict[str, Any]]:
    statuses = {item.dataset_id: item for item in verify_catalog(project)}
    rows: list[dict[str, Any]] = []
    for dataset_id in dataset_ids:
        dataset_id = str(dataset_id).strip()
        item = statuses.get(dataset_id)
        if item is None:
            raise ResultError(f"输入 Dataset 未登记: {dataset_id}")
        if item.status != "current" or not item.current_sha256:
            raise ResultError(
                f"输入 Dataset 必须为 current: {dataset_id} ({item.status})"
            )
        rows.append({
            "dataset": dataset_id,
            "sha256": item.current_sha256,
            "path": item.path,
        })
    return rows


def _file_inputs(
    project: ResearchProject,
    paths: Iterable[str],
) -> list[dict[str, Any]]:
    return [_fingerprint(project, path) for path in paths]


def register_result(
    project: ResearchProject,
    *,
    result_id: str,
    result_type: str,
    title: str = "",
    source_manifest: str = "",
    run_id: str = "",
    run_manifest: str = "",
    input_datasets: Iterable[str] = (),
    input_files: Iterable[str] = (),
    artifacts: Iterable[str] = (),
    artifact_roles: dict[str, str] | None = None,
    diagnostics: dict[str, Any] | None = None,
    force: bool = False,
) -> Path:
    result_id = validate_result_id(result_id)
    result_type = validate_result_type(result_type)
    target = result_manifest_path(project, result_id)
    previous: dict[str, Any] | None = None
    if target.is_file():
        if not force:
            raise ResultError(
                f"Result 已登记: {result_id}；如需刷新 fingerprint，请使用 --force。"
            )
        try:
            previous = load_yaml(target)
        except Exception:
            previous = None

    source: dict[str, Any] | None = None
    if source_manifest:
        source_path, relative = _project_file(project, source_manifest)
        source = {
            "manifest": relative,
            "sha256": sha256_file(source_path),
        }

    run = _resolve_run_manifest(project, run_id=run_id, run_manifest=run_manifest)
    datasets = _dataset_inputs(project, input_datasets)
    files = _file_inputs(project, input_files)
    roles = artifact_roles or {}
    artifact_rows: list[dict[str, Any]] = []
    seen_artifacts: set[str] = set()
    for artifact in artifacts:
        row = _fingerprint(project, artifact)
        if row["path"] in seen_artifacts:
            continue
        seen_artifacts.add(row["path"])
        role = roles.get(row["path"]) or roles.get(str(artifact)) or "artifact"
        row["role"] = role
        artifact_rows.append(row)

    created_at = (
        str(previous.get("created_at"))
        if isinstance(previous, dict) and previous.get("created_at")
        else _iso()
    )
    payload: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "kind": "research-result",
        "result": {
            "id": result_id,
            "type": result_type,
            "title": title.strip() or result_id,
        },
        "source": source,
        "run": run,
        "inputs": {
            "datasets": datasets,
            "files": files,
        },
        "artifacts": artifact_rows,
        "diagnostics": diagnostics or {},
        "created_at": created_at,
        "updated_at": _iso(),
    }
    payload["hash"] = result_hash(payload)
    write_yaml(target, payload)
    return target


def validate_result_manifest(
    data: dict[str, Any],
    *,
    expected_id: str | None = None,
) -> dict[str, Any]:
    if data.get("schema") != RESULT_SCHEMA:
        raise ResultError(
            f"不支持的 Result manifest schema: {data.get('schema')!r}"
        )
    if data.get("kind") != "research-result":
        raise ResultError("Result manifest kind 必须是 research-result。")
    result = data.get("result")
    if not isinstance(result, dict):
        raise ResultError("Result manifest 缺少 result mapping。")
    result_id = validate_result_id(str(result.get("id") or ""))
    validate_result_type(str(result.get("type") or ""))
    if expected_id is not None and result_id != validate_result_id(expected_id):
        raise ResultError(
            f"Result manifest id={result_id} 与文件名 {expected_id} 不一致。"
        )
    inputs = data.get("inputs")
    if not isinstance(inputs, dict):
        raise ResultError("Result manifest 缺少 inputs mapping。")
    if not isinstance(inputs.get("datasets", []), list):
        raise ResultError("inputs.datasets 必须是 list。")
    if not isinstance(inputs.get("files", []), list):
        raise ResultError("inputs.files 必须是 list。")
    if not isinstance(data.get("artifacts", []), list):
        raise ResultError("artifacts 必须是 list。")
    expected_hash = str(data.get("hash") or "")
    if not expected_hash:
        raise ResultError("Result manifest 缺少 hash。")
    if result_hash(data) != expected_hash:
        raise ResultError("Result manifest provenance 与 hash 不一致。")
    return data


def load_result_manifest(project: ResearchProject, result_id: str) -> dict[str, Any]:
    result_id = validate_result_id(result_id)
    path = result_manifest_path(project, result_id)
    if not path.is_file():
        raise ResultError(f"Result manifest 不存在: {result_id}")
    data = load_yaml(path)
    return validate_result_manifest(data, expected_id=result_id)


def list_result_ids(project: ResearchProject) -> list[str]:
    root = registry_dir(project)
    if not root.is_dir():
        return []
    return sorted(path.stem for path in root.glob("*.yaml") if path.is_file())


def _check_fingerprint(
    project: ResearchProject,
    item: dict[str, Any],
    *,
    label: str,
) -> tuple[str | None, str | None]:
    path_value = str(item.get("path") or item.get("manifest") or "")
    expected = str(item.get("sha256") or "")
    if not path_value:
        return "invalid", f"{label} 缺少 path/manifest"
    try:
        path, relative = _project_file(project, path_value, must_exist=False)
    except Exception as exc:
        return "invalid", f"{label}: {exc}"
    if not path.is_file():
        return "missing", f"{label} missing: {relative}"
    if not expected:
        return "invalid", f"{label} 缺少 sha256: {relative}"
    current = sha256_file(path)
    if current != expected:
        return "stale", f"{label} SHA256 changed: {relative}"
    return None, None


def result_status(project: ResearchProject, result_id: str) -> ResultStatus:
    result_id = validate_result_id(result_id)
    path = result_manifest_path(project, result_id)
    if not path.is_file():
        return ResultStatus(
            result_id, None, "invalid", None, None, None, None, 0,
            "result manifest missing",
        )
    try:
        data = load_yaml(path)
        validate_result_manifest(data, expected_id=result_id)
    except Exception as exc:
        return ResultStatus(
            result_id, None, "invalid", None, None, None, None, 0,
            f"{type(exc).__name__}: {exc}",
        )

    result = data["result"]
    result_type = str(result["type"])
    title = str(result.get("title") or result_id)
    problems: list[tuple[str, str]] = []

    source = data.get("source")
    if isinstance(source, dict):
        state, message = _check_fingerprint(project, source, label="source manifest")
        if state and message:
            problems.append((state, message))

    run = data.get("run")
    if isinstance(run, dict):
        state, message = _check_fingerprint(project, run, label="run manifest")
        if state and message:
            problems.append((state, message))
        elif run.get("manifest"):
            try:
                run_data = load_json(project.root / str(run["manifest"]))
                if run_data.get("success") is False:
                    problems.append(("invalid", "linked run is unsuccessful"))
            except Exception as exc:
                problems.append(("invalid", f"invalid linked run manifest: {exc}"))

    dataset_statuses = {item.dataset_id: item for item in verify_catalog(project)}
    inputs = data.get("inputs") if isinstance(data.get("inputs"), dict) else {}
    for item in inputs.get("datasets", []):
        if not isinstance(item, dict):
            problems.append(("invalid", "invalid input dataset entry"))
            continue
        dataset_id = str(item.get("dataset") or "")
        expected = str(item.get("sha256") or "")
        current = dataset_statuses.get(dataset_id)
        if current is None:
            problems.append(("missing", f"input dataset not registered: {dataset_id}"))
        elif current.status != "current":
            problems.append(("stale", f"input dataset {dataset_id} is {current.status}"))
        elif expected and current.current_sha256 != expected:
            problems.append(("stale", f"input dataset SHA256 changed: {dataset_id}"))
        elif not expected:
            problems.append(("invalid", f"input dataset missing sha256: {dataset_id}"))

    for item in inputs.get("files", []):
        if not isinstance(item, dict):
            problems.append(("invalid", "invalid input file entry"))
            continue
        state, message = _check_fingerprint(project, item, label="input file")
        if state and message:
            problems.append((state, message))

    artifacts = data.get("artifacts") if isinstance(data.get("artifacts"), list) else []
    for item in artifacts:
        if not isinstance(item, dict):
            problems.append(("invalid", "invalid artifact entry"))
            continue
        state, message = _check_fingerprint(project, item, label="artifact")
        if state and message:
            problems.append((state, message))

    priority = {"invalid": 3, "missing": 2, "stale": 1}
    if problems:
        final_state, final_message = max(
            problems,
            key=lambda pair: priority.get(pair[0], 0),
        )
    else:
        final_state, final_message = "current", "result provenance and artifacts match"

    return ResultStatus(
        result_id=result_id,
        result_type=result_type,
        status=final_state,
        hash=str(data.get("hash") or ""),
        title=title,
        manifest=(
            str(source.get("manifest"))
            if isinstance(source, dict) and source.get("manifest")
            else None
        ),
        run=(
            str(run.get("id"))
            if isinstance(run, dict) and run.get("id")
            else None
        ),
        artifacts=len(artifacts),
        message=final_message,
    )


def verify_registry(project: ResearchProject) -> list[ResultStatus]:
    return [result_status(project, result_id) for result_id in list_result_ids(project)]


def result_type_counts(statuses: Iterable[ResultStatus]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in statuses:
        key = item.result_type or "invalid"
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def _legacy_artifacts(data: dict[str, Any]) -> list[str]:
    outputs = data.get("outputs")
    if not isinstance(outputs, dict):
        return []
    result: list[str] = []
    for item in outputs.values():
        if isinstance(item, dict) and item.get("path"):
            result.append(str(item["path"]))
    return result


def _sync_one(
    project: ResearchProject,
    *,
    result_id: str,
    result_type: str,
    source_manifest: Path,
    title: str,
    input_files: Iterable[str] = (),
    artifacts: Iterable[str] = (),
) -> str:
    target = result_manifest_path(project, result_id)
    existed = target.is_file()
    register_result(
        project,
        result_id=result_id,
        result_type=result_type,
        title=title,
        source_manifest=source_manifest.relative_to(project.root).as_posix(),
        input_files=input_files,
        artifacts=artifacts,
        force=existed,
    )
    return "updated" if existed else "created"


def sync_legacy_results(project: ResearchProject) -> list[dict[str, str]]:
    """Import existing V1 economics result manifests into the unified registry."""

    root = project.root
    changes: list[dict[str, str]] = []

    for path in sorted((root / "results" / "models").glob("*/model.json")):
        data = load_json(path)
        name = validate_result_id(str(data.get("name") or path.parent.name))
        data_info = data.get("data") if isinstance(data.get("data"), dict) else {}
        input_files = [str(data_info["path"])] if data_info.get("path") else []
        state = _sync_one(
            project,
            result_id=f"model-{name}",
            result_type="model",
            source_manifest=path,
            title=str(data.get("title") or name),
            input_files=input_files,
            artifacts=_legacy_artifacts(data),
        )
        changes.append({"id": f"model-{name}", "action": state, "source": path.relative_to(root).as_posix()})

    for path in sorted((root / "results" / "comparisons").glob("*/comparison.json")):
        data = load_json(path)
        name = validate_result_id(str(data.get("name") or path.parent.name))
        input_files = [
            str(item.get("manifest"))
            for item in data.get("models", [])
            if isinstance(item, dict) and item.get("manifest")
        ]
        state = _sync_one(
            project,
            result_id=f"comparison-{name}",
            result_type="model-comparison",
            source_manifest=path,
            title=str(data.get("title") or name),
            input_files=input_files,
            artifacts=_legacy_artifacts(data),
        )
        changes.append({"id": f"comparison-{name}", "action": state, "source": path.relative_to(root).as_posix()})

    for path in sorted((root / "results" / "did").glob("*/did.json")):
        data = load_json(path)
        name = validate_result_id(str(data.get("name") or path.parent.name))
        design = data.get("design") if isinstance(data.get("design"), dict) else {}
        input_files = [str(design["data"])] if design.get("data") else []
        state = _sync_one(
            project,
            result_id=f"did-{name}",
            result_type="did",
            source_manifest=path,
            title=str(data.get("title") or name),
            input_files=input_files,
            artifacts=_legacy_artifacts(data),
        )
        changes.append({"id": f"did-{name}", "action": state, "source": path.relative_to(root).as_posix()})

    return changes
