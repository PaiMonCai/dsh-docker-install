"""Stable JSON interface helpers for DSH Research CLI commands."""

from __future__ import annotations

import json
import os
from typing import Any, Mapping

JSON_API_NAME = "dsh-research"
JSON_API_VERSION = 1


def api_envelope(
    *,
    command: str,
    operation: str,
    ok: bool,
    data: Mapping[str, Any] | None = None,
    error: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the stable top-level JSON envelope used by Research V2 CLIs."""

    return {
        "api": {
            "name": JSON_API_NAME,
            "version": JSON_API_VERSION,
        },
        "command": command,
        "operation": operation,
        "ok": bool(ok),
        "data": dict(data or {}),
        "error": dict(error) if error is not None else None,
    }


def error_object(
    code: str,
    message: str,
    *,
    error_type: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "code": str(code),
        "message": str(message),
    }
    if error_type:
        value["type"] = str(error_type)
    if details:
        value["details"] = dict(details)
    return value


def print_json(payload: Mapping[str, Any]) -> None:
    print(json.dumps(dict(payload), ensure_ascii=False, indent=2))


def success_json(
    *,
    command: str,
    operation: str,
    data: Mapping[str, Any] | None = None,
) -> None:
    print_json(api_envelope(command=command, operation=operation, ok=True, data=data))


def failure_json(
    *,
    command: str,
    operation: str,
    code: str,
    message: str,
    error_type: str | None = None,
    details: Mapping[str, Any] | None = None,
    data: Mapping[str, Any] | None = None,
) -> None:
    print_json(
        api_envelope(
            command=command,
            operation=operation,
            ok=False,
            data=data,
            error=error_object(
                code,
                message,
                error_type=error_type,
                details=details,
            ),
        )
    )
