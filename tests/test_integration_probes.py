"""Offline, negative-path contract tests for integration probe boundaries."""

from __future__ import annotations

import unittest
from typing import Any

from integrations.forma.probe import verify_forma
from integrations.opencad.probe import verify_opencad
from integrations.openindustries.probe import verify_openindustries


class IntegrationProbeTests(unittest.TestCase):
    """Ensure probes reject unavailable or inconsistent responses."""

    def test_forma_rejects_missing_process(self) -> None:
        """Registry discovery must fail closed on missing process support."""
        with self.assertRaisesRegex(ValueError, "lacks chemical or process"):
            verify_forma(lambda op, payload: {"domains": {"chemical": {}}})

    def test_forma_accepts_real_schema_shapes(self) -> None:
        """An explicit registry and schema response yields a scoped pass."""
        def call(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
            """Return deterministic domain capabilities for this unit test."""
            if operation == "registry":
                return {"domains": {"chemical": {}, "process": {}}}
            return {"document": {"type": "object"}, "context": {"type": "object"}}
        self.assertEqual(verify_forma(call)["system"], "forma")

    def test_opencad_rejects_unchanged_empty_box(self) -> None:
        """A missing shape cannot pass the CAD smoke check."""
        with self.assertRaisesRegex(ValueError, "invalid"):
            verify_opencad(lambda: (None, (0.0, 0.0, 0.0)))

    def test_opencad_accepts_exact_bbox(self) -> None:
        """A valid returned geometry bounding box is recognized."""
        self.assertEqual(
            verify_opencad(lambda: ("shape-reference", (2.0, 3.0, 4.0)))["status"],
            "pass",
        )

    def test_oi_rejects_unhealthy_response(self) -> None:
        """An unhealthy OI runtime must not be called connected."""
        def request(_url: str) -> dict[str, Any]:
            """Return unhealthy synthetic response."""
            return {"version": 1, "scheduler_healthy": False}
        with self.assertRaisesRegex(ValueError, "unhealthy"):
            verify_openindustries("http://127.0.0.1:8792", request)

    def test_oi_accepts_health_and_describe(self) -> None:
        """The documented OI health/describe contract is required."""
        def request(url: str) -> dict[str, Any]:
            """Return the appropriate strict schema fixture."""
            if url.endswith("/health"):
                return {
                    "version": 1,
                    "scheduler_healthy": True,
                    "module": {"module_id": "field-lab"},
                }
            return {
                "version": 1,
                "modeled_only": True,
                "command_schema": {"type": "object"},
                "snapshot_schema": {"type": "object"},
            }
        self.assertEqual(
            verify_openindustries("http://127.0.0.1:8792", request)["status"],
            "pass",
        )

    def test_oi_rejects_nonlocal_endpoint(self) -> None:
        """A remote URL must never receive credentials from this skeleton."""
        with self.assertRaisesRegex(ValueError, "localhost"):
            verify_openindustries("https://example.org")


if __name__ == "__main__":
    unittest.main()
