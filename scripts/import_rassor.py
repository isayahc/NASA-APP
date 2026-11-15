#!/usr/bin/env python3
"""Download NASA's published RASSOR GLB and export a reference STL.

This is an *unrigged visual reference mesh*, not validated fabrication CAD.
Original NASA asset: https://science.nasa.gov/3d-resources/regolith-advanced-surface-systems-operations-robot-rassor/
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

import trimesh

SOURCE_URL = (
    "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/"
    "master/3D%20Models/"
    "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29/"
    "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29.glb"
)
OUTPUT_DEFAULT = Path("assets/rassor/rassor-nasa-reference.stl")
CREDIT = "NASA/Dewey L. Smith; NASA/Jason M. Schuler"


def download_source(url: str) -> bytes:
    """Fetch NASA's GLB using an explicit timeout and user agent."""
    request = Request(url, headers={"User-Agent": "NASA-APP-RASSOR-Asset-Importer/1.0"})
    with urlopen(request, timeout=120) as response:
        data = response.read()
    if not data.startswith(b"glTF"):
        raise ValueError("Downloaded source is not a binary glTF (GLB) file")
    return data


def sha256(data: bytes) -> str:
    """Return a SHA-256 hex digest for immutable attribution metadata."""
    return hashlib.sha256(data).hexdigest()


def build_stl(output_path: Path, max_faces: int) -> dict[str, object]:
    """Convert NASA's original scene to a transformed, bounded-size binary STL."""
    source = download_source(SOURCE_URL)

    import io

    loaded = trimesh.load(io.BytesIO(source), file_type="glb", force="scene")
    if not isinstance(loaded, trimesh.Scene):
        raise TypeError(f"Expected a trimesh.Scene, received {type(loaded).__name__}")

    # Scene.dump bakes each node's world-space transform into its mesh geometry.
    # A single STL does NOT preserve per-part hierarchy, textures, or rigging.
    mesh = loaded.dump(concatenate=True)
    if not isinstance(mesh, trimesh.Trimesh):
        raise TypeError(f"Expected concatenated mesh, got {type(mesh).__name__}")
    if mesh.is_empty or len(mesh.faces) == 0:
        raise ValueError("NASA source has no printable triangle geometry")

    original_faces = int(len(mesh.faces))
    if original_faces > max_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
    if mesh.is_empty or len(mesh.faces) == 0:
        raise ValueError("Mesh became empty after decimation")
    if not mesh.is_finite:
        raise ValueError("Mesh contains non-finite geometry")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    binary = trimesh.exchange.stl.export_stl(mesh)
    output_path.write_bytes(binary)

    metadata: dict[str, object] = {
        "asset_name": "NASA RASSOR visual reference",
        "original_source_url": SOURCE_URL,
        "nasa_catalog": (
            "https://science.nasa.gov/3d-resources/"
            "regolith-advanced-surface-systems-operations-robot-rassor/"
        ),
        "source_credit": CREDIT,
        "source_format": "GLB",
        "derived_format": "STL (binary)",
        "source_bytes": len(source),
        "source_sha256": sha256(source),
        "original_triangle_count": original_faces,
        "exported_triangle_count": int(len(mesh.faces)),
        "max_triangle_target": max_faces,
        "output_bytes": len(binary),
        "output_sha256": sha256(binary),
        "bounds_in_source_coordinates": mesh.bounds.tolist(),
        "notes": [
            "Converted reference visualization mesh; not independently engineered.",
            "STL discards materials, textures, hierarchy, joints, rigging and physical validity.",
            "Source geometry dimensions/origin have not been validated as flight hardware.",
            "Do not claim this file is NASA-certified, printable, manufacturable or functional.",
            "NASA acknowledgment is required; no NASA endorsement is implied.",
        ],
    }
    metadata_path = output_path.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> None:
    """Parse command-line options and produce a provenance-tracked STL."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--max-faces", type=int, default=250_000)
    args = parser.parse_args()
    if args.max_faces < 1_000:
        parser.error("--max-faces must be >= 1000")
    data = build_stl(args.output, args.max_faces)
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
