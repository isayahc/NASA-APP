"""Verify actual OpenCAD analytic solid construction without optional OCCT."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def verify_opencad(
    builder: Callable[[], tuple[str | None, tuple[float, float, float]]] | None = None,
) -> dict[str, Any]:
    """Create a real small parametric box and validate bounding-box dimensions.

    The analytic backend proves operation wiring only; STEP export, native CAD,
    printed components and robot articulation require separate integration tests.
    """
    if builder is None:
        from opencad import Part, RuntimeContext

        context = RuntimeContext()
        part = Part(context=context).box(2.0, 3.0, 4.0)
        shape_id = part.shape_id
        shape = context.kernel.store.get(shape_id) if shape_id else None
        if shape is None:
            raise ValueError("OpenCAD analytic kernel produced no shape")
        bbox = shape.bbox
        bounds = (
            float(bbox.max_x - bbox.min_x),
            float(bbox.max_y - bbox.min_y),
            float(bbox.max_z - bbox.min_z),
        )
    else:
        shape_id, bounds = builder()
    if not shape_id or any(abs(x - y) > 1e-6 for x, y in zip(bounds, (2.0, 3.0, 4.0))):
        raise ValueError(f"OpenCAD box dimensions invalid: {bounds!r}")
    return {
        "system": "opencad",
        "status": "pass",
        "verified": "real analytic Part.box operation and exact bounding dimensions",
        "note": "OCCT STEP export and OI geometry handoff not yet tested.",
    }
