"""Exercise actual OpenForma domain discovery without invoking a model provider."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def verify_forma(call: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None) -> dict[str, Any]:
    """Discover ChemicalIR and ProcessIR capabilities and verify schema access.

    A supplied callable permits unit tests without installing Forma. The normal
    path calls OpenForma's real public `call_domain_tool` implementation.
    """
    if call is None:
        from forma_core.domains.tools import call_domain_tool

        call = call_domain_tool
    result = call("registry", {})
    domains = result.get("domains")
    if not isinstance(domains, dict) or not {"chemical", "process"} <= set(domains):
        raise ValueError("OpenForma registry lacks chemical or process domains")
    for domain in ("chemical", "process"):
        schema = call("schema", {"domain": domain})
        if not isinstance(schema, dict) or not isinstance(schema.get("document"), dict):
            raise ValueError(f"OpenForma {domain} schema unavailable")
    return {
        "system": "forma",
        "status": "pass",
        "verified": "native chemical/process domain registry and document schemas",
        "note": "No engineering artifact generated; no model provider invoked.",
    }
