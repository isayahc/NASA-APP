"""Run real MA integration smoke checks; fail on missing dependencies or service.

Usage (after installing MA OpenForma and OpenCAD):
    python -m scripts.smoke_integrations --oi-url http://127.0.0.1:8792

This is not an autonomous lunar factory demo and never substitutes mock checks
for real integration probes.
"""

from __future__ import annotations

import argparse
import json
import time
from typing import Any

from integrations.forma.probe import verify_forma
from integrations.opencad.probe import verify_opencad
from integrations.openindustries.probe import verify_openindustries


def run_checks(oi_url: str, wait_seconds: int = 30) -> list[dict[str, Any]]:
    """Run actual public API checks, waiting only for the local OI service."""
    results = [verify_forma(), verify_opencad()]
    start = time.monotonic()
    while True:
        try:
            results.append(verify_openindustries(oi_url))
            return results
        except (OSError, ConnectionError, TimeoutError):
            if time.monotonic() - start >= wait_seconds:
                raise
            time.sleep(1)


def main() -> None:
    """Parse the OI development endpoint and print structured check results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--oi-url", default="http://127.0.0.1:8792")
    parser.add_argument("--wait-seconds", type=int, default=30)
    options = parser.parse_args()
    results = run_checks(options.oi_url, options.wait_seconds)
    print(json.dumps({"status": "pass", "integrations": results}, indent=2))


if __name__ == "__main__":
    main()
