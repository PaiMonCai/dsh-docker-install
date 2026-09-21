"""Deterministic SHA256 helpers for Research inputs and artifacts."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


_CHUNK_SIZE = 1024 * 1024


def sha256_file(path: str | Path) -> str:
    """Return the SHA256 hex digest of one regular file."""

    source = Path(path)
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        while chunk := handle.read(_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class FileFingerprint:
    path: str
    sha256: str
    size: int


def fingerprint_file(
    path: str | Path, *, relative_to: str | Path | None = None
) -> FileFingerprint:
    """Return path, SHA256, and byte size for one file."""

    source = Path(path)
    display = source
    if relative_to is not None:
        display = source.resolve().relative_to(Path(relative_to).resolve())
    return FileFingerprint(
        path=display.as_posix(),
        sha256=sha256_file(source),
        size=source.stat().st_size,
    )


def iter_tree_files(root: str | Path) -> Iterable[Path]:
    """Yield regular files under *root* in stable relative-path order.

    Symlinks are intentionally not followed; manifests should fingerprint the
    project files themselves rather than silently escape the project tree.
    """

    base = Path(root)
    if not base.exists():
        return ()
    if base.is_file():
        return (base,)

    files = [path for path in base.rglob("*") if path.is_file() and not path.is_symlink()]
    files.sort(key=lambda path: path.relative_to(base).as_posix())
    return tuple(files)


def tree_digest(root: str | Path) -> str:
    """Return one deterministic digest for a directory tree.

    Both relative paths and file contents contribute to the digest, so a rename
    changes the fingerprint even if bytes are unchanged.
    """

    base = Path(root)
    digest = hashlib.sha256()

    for path in iter_tree_files(base):
        relative = path.name if base.is_file() else path.relative_to(base).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\n")

    return digest.hexdigest()
