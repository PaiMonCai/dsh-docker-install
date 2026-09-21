from __future__ import annotations

import unittest

from dsh_research.json_api import (
    JSON_API_NAME,
    JSON_API_VERSION,
    api_envelope,
    error_object,
)


class JsonApiTests(unittest.TestCase):
    def test_success_envelope_shape_is_stable(self) -> None:
        payload = api_envelope(
            command="research-data",
            operation="list",
            ok=True,
            data={"dataset_schema": 1, "datasets": []},
        )
        self.assertEqual(
            list(payload.keys()),
            ["api", "command", "operation", "ok", "data", "error"],
        )
        self.assertEqual(payload["api"], {
            "name": JSON_API_NAME,
            "version": JSON_API_VERSION,
        })
        self.assertTrue(payload["ok"])
        self.assertIsNone(payload["error"])
        self.assertEqual(payload["data"]["dataset_schema"], 1)

    def test_error_envelope_is_machine_readable(self) -> None:
        error = error_object(
            "PROJECT_NOT_FOUND",
            "missing project",
            error_type="ProjectNotFoundError",
            details={"path": "/tmp/x"},
        )
        payload = api_envelope(
            command="research-status",
            operation="status",
            ok=False,
            error=error,
        )
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "PROJECT_NOT_FOUND")
        self.assertEqual(payload["error"]["type"], "ProjectNotFoundError")
        self.assertEqual(payload["error"]["details"]["path"], "/tmp/x")


if __name__ == "__main__":
    unittest.main()
