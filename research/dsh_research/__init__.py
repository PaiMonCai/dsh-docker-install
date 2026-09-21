"""Shared internal engine for DSH Research Edition.

The public user interface remains the `research-*` CLI family.  This package
contains reusable implementation details so those commands share one project
and manifest protocol instead of reimplementing it independently.
"""

from .checks import CheckReport, CheckResult, run_checks
from .config import load_research_config, load_yaml, write_yaml
from .hashing import FileFingerprint, fingerprint_file, sha256_file, tree_digest
from .manifests import load_json, read_jsonl, write_json, write_jsonl
from .project import ResearchProject, find_project_root
from .schema import CURRENT_PROJECT_SCHEMA, migrate_config, migrate_project, validate_project_schema
from .state import ProjectState, build_project_state
from .vcs import GitState, git_state

__all__ = [
    "CheckReport",
    "CheckResult",
    "FileFingerprint",
    "GitState",
    "ResearchProject",
    "ProjectState",
    "CURRENT_PROJECT_SCHEMA",
    "build_project_state",
    "find_project_root",
    "fingerprint_file",
    "git_state",
    "load_json",
    "load_research_config",
    "load_yaml",
    "migrate_config",
    "migrate_project",
    "read_jsonl",
    "run_checks",
    "sha256_file",
    "tree_digest",
    "write_json",
    "write_jsonl",
    "validate_project_schema",
    "write_yaml",
]
