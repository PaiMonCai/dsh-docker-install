"""Pipeline DAG, signatures, stale detection, and incremental execution."""

from __future__ import annotations

import glob
import hashlib
import json
import os
import platform
import shlex
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .config import load_research_config, load_yaml
from .datasets import verify_catalog
from .errors import ResearchError
from .hashing import sha256_file
from .manifests import load_json, write_json
from .project import ResearchProject

PIPELINE_SCHEMA = 1


class PipelineError(ResearchError):
    """Raised when pipeline configuration or execution is invalid."""


@dataclass(frozen=True, slots=True)
class PipelineStep:
    name: str
    command: tuple[str, ...]
    depends_on: tuple[str, ...]
    input_datasets: tuple[str, ...]
    input_files: tuple[str, ...]
    output_datasets: tuple[str, ...]
    output_files: tuple[str, ...]
    config_keys: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PipelineDefinition:
    schema: int
    path: Path
    steps: dict[str, PipelineStep]


@dataclass(frozen=True, slots=True)
class StepStatus:
    step: str
    status: str
    signature: str
    reasons: tuple[str, ...]
    latest_run: str | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _run_id(dt: datetime | None = None) -> str:
    value = dt or _now()
    return value.strftime("%Y%m%dT%H%M%S%fZ")


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _string_list(value: Any, *, field: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise PipelineError(f"{field} 必须是 list。")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise PipelineError(f"{field} 只能包含非空字符串。")
        result.append(item.strip())
    return tuple(result)


def _command(value: Any, *, step: str) -> tuple[str, ...]:
    if isinstance(value, str):
        parts = tuple(shlex.split(value))
    elif isinstance(value, list):
        if not all(isinstance(item, str) and item for item in value):
            raise PipelineError(f"step {step}: command list 只能包含非空字符串。")
        parts = tuple(value)
    else:
        raise PipelineError(f"step {step}: command 必须是 string 或 list。")
    if not parts:
        raise PipelineError(f"step {step}: command 不能为空。")
    return parts


def load_pipeline(
    project: ResearchProject,
    path: str | Path = "pipeline.yaml",
) -> PipelineDefinition:
    source = Path(path)
    if not source.is_absolute():
        source = project.root / source
    source = source.resolve()
    try:
        source.relative_to(project.root.resolve())
    except ValueError as exc:
        raise PipelineError("pipeline.yaml 必须位于 Research Project 内。") from exc
    if not source.is_file():
        raise PipelineError(f"Pipeline 配置不存在: {source}")

    raw = load_yaml(source)
    if raw.get("schema") != PIPELINE_SCHEMA:
        raise PipelineError(
            f"不支持的 pipeline schema: {raw.get('schema')!r}; current={PIPELINE_SCHEMA}"
        )
    raw_steps = raw.get("steps")
    if not isinstance(raw_steps, dict):
        raise PipelineError("pipeline.yaml 的 steps 必须是 mapping。")

    steps: dict[str, PipelineStep] = {}
    for name, item in raw_steps.items():
        if not isinstance(name, str) or not name.strip():
            raise PipelineError("Pipeline step name 必须是非空字符串。")
        if not isinstance(item, dict):
            raise PipelineError(f"step {name}: 配置必须是 mapping。")

        inputs = item.get("inputs") or {}
        outputs = item.get("outputs") or {}
        if not isinstance(inputs, dict):
            raise PipelineError(f"step {name}: inputs 必须是 mapping。")
        if not isinstance(outputs, dict):
            raise PipelineError(f"step {name}: outputs 必须是 mapping。")

        step = PipelineStep(
            name=name,
            command=_command(item.get("command"), step=name),
            depends_on=_string_list(item.get("depends_on"), field=f"{name}.depends_on"),
            input_datasets=_string_list(inputs.get("datasets"), field=f"{name}.inputs.datasets"),
            input_files=_string_list(inputs.get("files"), field=f"{name}.inputs.files"),
            output_datasets=_string_list(outputs.get("datasets"), field=f"{name}.outputs.datasets"),
            output_files=_string_list(outputs.get("files"), field=f"{name}.outputs.files"),
            config_keys=_string_list(item.get("config"), field=f"{name}.config"),
        )
        if not step.output_datasets and not step.output_files:
            raise PipelineError(
                f"step {name}: 至少声明一个 output dataset 或 file，才能判断 current/stale。"
            )
        steps[name] = step

    _validate_dag(steps)
    _validate_output_ownership(steps)
    return PipelineDefinition(PIPELINE_SCHEMA, source, steps)


def _validate_dag(steps: dict[str, PipelineStep]) -> None:
    for step in steps.values():
        for dependency in step.depends_on:
            if dependency not in steps:
                raise PipelineError(
                    f"step {step.name}: depends_on 引用了不存在的 step: {dependency}"
                )
            if dependency == step.name:
                raise PipelineError(f"step {step.name}: 不能依赖自己。")

    visiting: list[str] = []
    visited: set[str] = set()

    def visit(name: str) -> None:
        if name in visited:
            return
        if name in visiting:
            cycle = visiting[visiting.index(name):] + [name]
            raise PipelineError("Pipeline DAG 存在环: " + " -> ".join(cycle))
        visiting.append(name)
        for dependency in steps[name].depends_on:
            visit(dependency)
        visiting.pop()
        visited.add(name)

    for name in steps:
        visit(name)


def _validate_output_ownership(steps: dict[str, PipelineStep]) -> None:
    owners: dict[str, str] = {}
    for step in steps.values():
        outputs = [
            *(f"dataset:{value}" for value in step.output_datasets),
            *(f"file:{value}" for value in step.output_files),
        ]
        for output in outputs:
            previous = owners.get(output)
            if previous is not None:
                raise PipelineError(
                    f"output {output} 同时由 step {previous} 和 {step.name} 生成。"
                )
            owners[output] = step.name


def topological_order(
    pipeline: PipelineDefinition,
    targets: Iterable[str] | None = None,
) -> list[str]:
    if targets is None:
        selected = set(pipeline.steps)
    else:
        selected: set[str] = set()

        def include(name: str) -> None:
            if name not in pipeline.steps:
                raise PipelineError(f"未知 Pipeline step: {name}")
            if name in selected:
                return
            for dependency in pipeline.steps[name].depends_on:
                include(dependency)
            selected.add(name)

        for target in targets:
            include(target)

    result: list[str] = []
    seen: set[str] = set()

    def visit(name: str) -> None:
        if name in seen or name not in selected:
            return
        for dependency in pipeline.steps[name].depends_on:
            visit(dependency)
        seen.add(name)
        result.append(name)

    for name in pipeline.steps:
        visit(name)
    return result


def _project_file_matches(project: ResearchProject, pattern: str) -> list[Path]:
    if Path(pattern).is_absolute():
        raise PipelineError(f"Pipeline file pattern 不能是绝对路径: {pattern}")
    candidates = [
        Path(value).resolve()
        for value in glob.glob(str(project.root / pattern), recursive=True)
    ]
    files: list[Path] = []
    for candidate in candidates:
        try:
            candidate.relative_to(project.root.resolve())
        except ValueError as exc:
            raise PipelineError(f"Pipeline file pattern 越出项目目录: {pattern}") from exc
        if candidate.is_file() and not candidate.is_symlink():
            files.append(candidate)
    files.sort(key=lambda value: value.relative_to(project.root).as_posix())
    return files


def _file_inputs(project: ResearchProject, patterns: tuple[str, ...]) -> tuple[list[dict[str, Any]], list[str]]:
    snapshots: list[dict[str, Any]] = []
    problems: list[str] = []
    for pattern in patterns:
        matches = _project_file_matches(project, pattern)
        if not matches:
            snapshots.append({"pattern": pattern, "files": []})
            problems.append(f"input file pattern has no matches: {pattern}")
            continue
        snapshots.append(
            {
                "pattern": pattern,
                "files": [
                    {
                        "path": path.relative_to(project.root).as_posix(),
                        "sha256": sha256_file(path),
                        "size": path.stat().st_size,
                    }
                    for path in matches
                ],
            }
        )
    return snapshots, problems


def _dataset_inputs(project: ResearchProject, ids: tuple[str, ...]) -> tuple[list[dict[str, Any]], list[str]]:
    statuses = {item.dataset_id: item for item in verify_catalog(project)}
    snapshots: list[dict[str, Any]] = []
    problems: list[str] = []
    for dataset_id in ids:
        status = statuses.get(dataset_id)
        if status is None:
            snapshots.append({"dataset": dataset_id, "status": "missing", "sha256": None})
            problems.append(f"input dataset is not registered: {dataset_id}")
            continue
        snapshots.append(
            {
                "dataset": dataset_id,
                "status": status.status,
                "sha256": status.current_sha256,
                "path": status.path,
            }
        )
        if status.status != "current":
            problems.append(f"input dataset {dataset_id} is {status.status}")
    return snapshots, problems


def _config_value(config: dict[str, Any], dotted: str) -> Any:
    current: Any = config
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _runtime_identity() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "research_version": os.environ.get("DSH_RESEARCH_VERSION"),
        "research_pack": os.environ.get("DSH_RESEARCH_PACK", "none"),
    }


def _step_components(
    project: ResearchProject,
    pipeline: PipelineDefinition,
    name: str,
    *,
    memo: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cache = memo if memo is not None else {}
    if name in cache:
        return cache[name]

    step = pipeline.steps[name]
    dependency_components = {
        dependency: _step_components(project, pipeline, dependency, memo=cache)["signature"]
        for dependency in step.depends_on
    }
    dataset_inputs, dataset_problems = _dataset_inputs(project, step.input_datasets)
    file_inputs, file_problems = _file_inputs(project, step.input_files)
    config = load_research_config(project)
    selected_config = {
        key: _config_value(config, key)
        for key in step.config_keys
    }

    components: dict[str, Any] = {
        "command": list(step.command),
        "dependencies": dependency_components,
        "inputs": {
            "datasets": dataset_inputs,
            "files": file_inputs,
        },
        "config": selected_config,
        "runtime": _runtime_identity(),
        "problems": dataset_problems + file_problems,
    }
    signature_payload = {key: value for key, value in components.items() if key != "problems"}
    components["signature"] = _canonical_hash(signature_payload)
    cache[name] = components
    return components


def _step_run_root(project: ResearchProject, step: str) -> Path:
    return project.root / "runs" / "pipeline" / step


def _run_manifests(project: ResearchProject, step: str) -> list[Path]:
    root = _step_run_root(project, step)
    if not root.is_dir():
        return []
    return sorted(root.glob("*/manifest.json"), reverse=True)


def latest_successful_run(project: ResearchProject, step: str) -> tuple[Path, dict[str, Any]] | None:
    for path in _run_manifests(project, step):
        try:
            data = load_json(path)
        except Exception:
            continue
        if data.get("success") is True and data.get("exit_code") == 0:
            return path, data
    return None


def latest_run(project: ResearchProject, step: str) -> tuple[Path, dict[str, Any]] | None:
    paths = _run_manifests(project, step)
    if not paths:
        return None
    try:
        return paths[0], load_json(paths[0])
    except Exception:
        return None


def _output_snapshot(
    project: ResearchProject,
    step: PipelineStep,
) -> tuple[dict[str, Any], list[str]]:
    outputs: dict[str, Any] = {"datasets": [], "files": []}
    problems: list[str] = []

    statuses = {item.dataset_id: item for item in verify_catalog(project)}
    for dataset_id in step.output_datasets:
        status = statuses.get(dataset_id)
        if status is None:
            outputs["datasets"].append(
                {"dataset": dataset_id, "status": "missing", "sha256": None}
            )
            problems.append(f"output dataset is not registered: {dataset_id}")
            continue
        outputs["datasets"].append(
            {
                "dataset": dataset_id,
                "status": status.status,
                "sha256": status.current_sha256,
                "path": status.path,
            }
        )
        if status.status != "current":
            problems.append(f"output dataset {dataset_id} is {status.status}")

    for value in step.output_files:
        matches = _project_file_matches(project, value)
        if not matches:
            outputs["files"].append({"pattern": value, "files": []})
            problems.append(f"output file pattern has no matches: {value}")
            continue
        outputs["files"].append(
            {
                "pattern": value,
                "files": [
                    {
                        "path": path.relative_to(project.root).as_posix(),
                        "sha256": sha256_file(path),
                        "size": path.stat().st_size,
                    }
                    for path in matches
                ],
            }
        )
    return outputs, problems


def _component_change_reasons(previous: dict[str, Any], current: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    labels = {
        "command": "command changed",
        "dependencies": "dependency signature changed",
        "inputs": "input fingerprint changed",
        "config": "referenced research config changed",
        "runtime": "runtime identity changed",
    }
    for key, message in labels.items():
        if previous.get(key) != current.get(key):
            reasons.append(message)
    return reasons


def step_statuses(
    project: ResearchProject,
    pipeline: PipelineDefinition,
) -> dict[str, StepStatus]:
    order = topological_order(pipeline)
    status_map: dict[str, StepStatus] = {}
    component_memo: dict[str, dict[str, Any]] = {}

    for name in order:
        step = pipeline.steps[name]
        current = _step_components(project, pipeline, name, memo=component_memo)
        reasons = list(current.get("problems") or [])

        for dependency in step.depends_on:
            dependency_status = status_map[dependency]
            if dependency_status.status != "current":
                reasons.append(f"dependency {dependency} is {dependency_status.status}")

        previous = latest_successful_run(project, name)
        latest_path: str | None = None
        if previous is None:
            reasons.append("step has never completed successfully")
        else:
            path, manifest = previous
            latest_path = path.relative_to(project.root).as_posix()
            previous_components = (
                manifest.get("components")
                if isinstance(manifest.get("components"), dict)
                else {}
            )
            if manifest.get("signature") != current["signature"]:
                reasons.extend(_component_change_reasons(previous_components, current))
                if not _component_change_reasons(previous_components, current):
                    reasons.append("step signature changed")

            output_now, output_problems = _output_snapshot(project, step)
            reasons.extend(output_problems)
            previous_outputs = (
                manifest.get("outputs")
                if isinstance(manifest.get("outputs"), dict)
                else {}
            )
            if not output_problems and previous_outputs != output_now:
                reasons.append("output fingerprint changed")

        unique_reasons = tuple(dict.fromkeys(reasons))
        status_map[name] = StepStatus(
            name,
            "current" if not unique_reasons else "stale",
            str(current["signature"]),
            unique_reasons,
            latest_path,
        )
    return status_map


def _write_run_manifest(
    project: ResearchProject,
    step: PipelineStep,
    *,
    run_id: str,
    started_at: str,
    finished_at: str,
    components: dict[str, Any],
    outputs: dict[str, Any],
    exit_code: int,
    success: bool,
    error: str | None = None,
) -> Path:
    run_dir = _step_run_root(project, step.name) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": 1,
        "kind": "pipeline-step-run",
        "step": step.name,
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": finished_at,
        "command": list(step.command),
        "signature": components["signature"],
        "components": components,
        "outputs": outputs,
        "exit_code": exit_code,
        "success": success,
        "error": error,
    }
    return write_json(run_dir / "manifest.json", manifest)


def execute_pipeline(
    project: ResearchProject,
    pipeline: PipelineDefinition,
    *,
    target: str | None = None,
    force: bool = False,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    order = topological_order(pipeline, [target] if target else None)
    decisions: list[dict[str, Any]] = []

    for name in order:
        statuses = step_statuses(project, pipeline)
        status = statuses[name]
        if status.status == "current" and not force:
            decisions.append({"step": name, "action": "SKIP", "status": "current"})
            continue

        step = pipeline.steps[name]
        components = _step_components(project, pipeline, name)
        problems = list(components.get("problems") or [])
        dependency_statuses = step_statuses(project, pipeline)
        for dependency in step.depends_on:
            if dependency_statuses[dependency].status != "current":
                problems.append(
                    f"dependency {dependency} is {dependency_statuses[dependency].status}"
                )
        if problems:
            raise PipelineError(
                f"step {name} 无法执行: " + "; ".join(dict.fromkeys(problems))
            )

        decisions.append(
            {
                "step": name,
                "action": "RUN",
                "status": "stale",
                "reasons": list(status.reasons),
            }
        )
        if dry_run:
            continue

        run_id = _run_id()
        started = _iso()
        env = os.environ.copy()
        env["DSH_PIPELINE_STEP"] = name
        env["DSH_PIPELINE_RUN_ID"] = run_id
        try:
            completed = subprocess.run(
                list(step.command),
                cwd=project.root,
                env=env,
                check=False,
            )
            exit_code = int(completed.returncode)
        except OSError as exc:
            exit_code = 127
            outputs = {"datasets": [], "files": []}
            _write_run_manifest(
                project,
                step,
                run_id=run_id,
                started_at=started,
                finished_at=_iso(),
                components=components,
                outputs=outputs,
                exit_code=exit_code,
                success=False,
                error=f"{type(exc).__name__}: {exc}",
            )
            raise PipelineError(f"step {name} 无法启动: {exc}") from exc

        outputs, output_problems = _output_snapshot(project, step)
        success = exit_code == 0 and not output_problems
        error = None
        if exit_code != 0:
            error = f"command exited with {exit_code}"
        elif output_problems:
            error = "; ".join(output_problems)

        manifest_path = _write_run_manifest(
            project,
            step,
            run_id=run_id,
            started_at=started,
            finished_at=_iso(),
            components=components,
            outputs=outputs,
            exit_code=exit_code,
            success=success,
            error=error,
        )

        decisions[-1]["run_manifest"] = manifest_path.relative_to(project.root).as_posix()
        if not success:
            raise PipelineError(f"step {name} failed: {error}")

    return decisions


def explain_step(
    project: ResearchProject,
    pipeline: PipelineDefinition,
    step: str,
) -> StepStatus:
    if step not in pipeline.steps:
        raise PipelineError(f"未知 Pipeline step: {step}")
    return step_statuses(project, pipeline)[step]


def graph_edges(pipeline: PipelineDefinition) -> list[tuple[str, str]]:
    return [
        (dependency, step.name)
        for step in pipeline.steps.values()
        for dependency in step.depends_on
    ]
