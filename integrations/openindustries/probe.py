"""Read real OpenIndustries simulation-service health and public schema."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any
from urllib.request import Request, urlopen


def _request_json(url: str) -> dict[str, Any]:
    """Fetch a small loopback service JSON response with an explicit timeout."""
    request = Request(url, method="GET", headers={"Accept": "application/json"})
    with urlopen(request, timeout=5) as response:
        raw = response.read(1_000_001)
    if len(raw) > 1_000_000:
        raise ValueError("OpenIndustries response exceeded 1 MB")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("OpenIndustries returned non-object JSON")
    return payload


def verify_openindustries(
    base_url: str,
    request_json: Callable[[str], dict[str, Any]] = _request_json,
) -> dict[str, Any]:
    """Check a real OI field-lab service's unauthenticated read-only endpoints.

    The field-lab service tests the existing generic simulation transport and
    schema boundary. It is *not* a lunar-factory runtime or robot E2E proof.
    """
    if not base_url.startswith("http://127.0.0.1:") and not base_url.startswith(
        "http://localhost:"
    ):
        raise ValueError("Only explicit localhost OI development services are supported")
    origin = base_url.rstrip("/")
    health = request_json(origin + "/health")
    schema = request_json(origin + "/simulation/describe")
    if health.get("version") != 1 or health.get("scheduler_healthy") is not True:
        raise ValueError(f"OpenIndustries unhealthy: {health!r}")
    module = health.get("module")
    if not isinstance(module, dict) or module.get("module_id") != "field-lab":
        raise ValueError("OpenIndustries does not expose the expected field-lab runtime")
    if schema.get("version") != 1 or schema.get("modeled_only") is not True:
        raise ValueError("OpenIndustries describe contract missing modeled-only marker")
    if not isinstance(schema.get("command_schema"), dict) or not isinstance(
        schema.get("snapshot_schema"), dict
    ):
        raise ValueError("OpenIndustries describe schemas missing")
    return {
        "system": "openindustries",
        "status": "pass",
        "verified": "running OI health, pinned domain and public simulation schemas",
        "note": "No persistent scene mutation, 3D animation, or lunar operations tested.",
    }
