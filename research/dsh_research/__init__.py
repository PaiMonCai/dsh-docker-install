"""Shared internal engine for DSH Research Edition.

The public user interface remains the `research-*` CLI family.  This package
contains reusable implementation details so those commands share one project
and manifest protocol instead of reimplementing it independently.
"""

from .checks import RELEASE_GATE_POLICY_VERSION, CheckReport, CheckResult, run_checks
from .config import load_research_config, load_yaml, write_yaml
from .dashboard import DASHBOARD_API_VERSION, DashboardError, make_server
from .datasets import (
    DATASET_SCHEMA,
    DatasetStatus,
    all_dataset_statuses,
    dataset_status,
    lineage_tree,
    load_dataset_manifest,
    register_dataset,
    verify_catalog,
)
from .hashing import FileFingerprint, fingerprint_file, sha256_file, tree_digest
from .json_api import JSON_API_NAME, JSON_API_VERSION, api_envelope, error_object
from .manifests import load_json, read_jsonl, write_json, write_jsonl
from .pipeline import (
    PIPELINE_SCHEMA,
    PipelineDefinition,
    PipelineStep,
    StepStatus,
    execute_pipeline,
    load_pipeline,
    step_statuses,
    topological_order,
)
from .project import ResearchProject, find_project_root
from .runs import RUN_MANIFEST_SCHEMA, RunResult, record_run
from .results import (
    RESULT_SCHEMA,
    ResultStatus,
    load_result_manifest,
    register_result,
    result_status,
    result_type_counts,
    sync_legacy_results,
    verify_registry,
)
from .schema import CURRENT_PROJECT_SCHEMA, migrate_config, migrate_project, validate_project_schema
from .state import ProjectState, build_project_state
from .vcs import GitState, git_state

__all__ = [
    "CheckReport",
    "CheckResult",
    "DASHBOARD_API_VERSION",
    "DashboardError",
    "DATASET_SCHEMA",
    "DatasetStatus",
    "FileFingerprint",
    "GitState",
    "JSON_API_NAME",
    "JSON_API_VERSION",
    "ResearchProject",
    "RUN_MANIFEST_SCHEMA",
    "RESULT_SCHEMA",
    "RELEASE_GATE_POLICY_VERSION",
    "ResultStatus",
    "RunResult",
    "ProjectState",
    "PIPELINE_SCHEMA",
    "PipelineDefinition",
    "PipelineStep",
    "StepStatus",
    "CURRENT_PROJECT_SCHEMA",
    "all_dataset_statuses",
    "api_envelope",
    "build_project_state",
    "dataset_status",
    "error_object",
    "execute_pipeline",
    "find_project_root",
    "fingerprint_file",
    "git_state",
    "lineage_tree",
    "load_dataset_manifest",
    "load_json",
    "load_pipeline",
    "load_result_manifest",
    "load_research_config",
    "load_yaml",
    "migrate_config",
    "make_server",
    "migrate_project",
    "read_jsonl",
    "record_run",
    "register_result",
    "result_status",
    "result_type_counts",
    "register_dataset",
    "run_checks",
    "sha256_file",
    "tree_digest",
    "step_statuses",
    "topological_order",
    "sync_legacy_results",
    "write_json",
    "write_jsonl",
    "validate_project_schema",
    "verify_catalog",
    "verify_registry",
    "write_yaml",
]
