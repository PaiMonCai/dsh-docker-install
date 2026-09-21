"""Shared internal engine for DSH Research Edition.

The public user interface remains the `research-*` CLI family.  This package
contains reusable implementation details so those commands share one project
and manifest protocol instead of reimplementing it independently.
"""

from .config import load_research_config, load_yaml, write_yaml
from .hashing import FileFingerprint, fingerprint_file, sha256_file, tree_digest
from .manifests import load_json, read_jsonl, write_json, write_jsonl
from .project import ResearchProject, find_project_root
from .vcs import GitState, git_state

__all__ = [
    "FileFingerprint",
    "GitState",
    "ResearchProject",
    "find_project_root",
    "fingerprint_file",
    "git_state",
    "load_json",
    "load_research_config",
    "load_yaml",
    "read_jsonl",
    "sha256_file",
    "tree_digest",
    "write_json",
    "write_jsonl",
    "write_yaml",
]
