"""Small filesystem primitives shared by Research commands."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def atomic_write_text(path: str | Path, text: str, *, encoding: str = "utf-8") -> Path:
    """Atomically replace *path* with *text*.

    The temporary file is created in the destination directory so `os.replace`
    stays on the same filesystem.  This prevents partially-written YAML/JSON
    manifests if a process is interrupted during a write.
    """

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    previous_mode: int | None = None
    try:
        previous_mode = target.stat().st_mode & 0o777
    except FileNotFoundError:
        pass

    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        if previous_mode is not None:
            os.chmod(tmp_name, previous_mode)
        os.replace(tmp_name, target)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise

    return target
