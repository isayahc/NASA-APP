#!/usr/bin/env python3
"""Download NASA RASSOR GLB and produce a validated nondegenerate reference STL.

Requires Blender 3.4+ installed on PATH. This is a VISUAL REFERENCE, not CAD,
rigging, printability, or flight-hardware certification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import trimesh

SOURCE_URL = (
    "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/"
    "master/3D%20Models/"
    "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29/"
    "Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29.glb"
)
CREDIT = "NASA/Dewey L. Smith; NASA/Jason M. Schuler"
OUTPUT_DEFAULT = Path("assets/rassor/rassor-nasa-reference.stl")
BLENDER_SCRIPT = Path(__file__).with_name("rassor_blender_export.py")


def sha256(raw: bytes) -> str:
    """Return SHA-256 digest for binary content."""
    return hashlib.sha256(raw).hexdigest()


def download_glb() -> bytes:
    """Fetch official NASA mirror and reject any response not containing GLB data."""
    request = Request(SOURCE_URL, headers={"User-Agent": "NASA-APP-Asset-Importer/1.0"})
    with urlopen(request, timeout=120) as response:
        raw = response.read()
    if not raw.startswith(b"glTF"):
        raise ValueError("NASA source did not return GLB binary content")
    return raw


def validate_stl(path: Path, max_faces: int) -> dict[str, object]:
    """Assert that binary STL has nonzero geometry, realistic bounds and size."""
    data = path.read_bytes()
    if len(data) < 84:
        raise ValueError("STL is truncated")
    num_triangles = struct.unpack_from("<I", data, 80)[0]
    if num_triangles < 1 or len(data) != 84 + 50 * num_triangles:
        raise ValueError(f"STL size/triangle-count mismatch: {len(data)} bytes, {num_triangles} triangles")
    if num_triangles > 100_000_000:
        raise ValueError("STL triangle count is implausibly high")
    # trimesh parses the final STL itself, *not* the original GLB, which has
    # decoder extensions that some glTF readers mishandle.
    mesh = trimesh.load(path, file_type="stl", force="mesh", process=False)
    bounds = np.asarray(mesh.bounds, dtype=float)
    if not np.isfinite(bounds).all() or np.max(bounds[1] - bounds[0]) <= 1e-5:
        raise ValueError(f"Invalid/degenerate STL geometry: bounds={bounds.tolist()}")
    if len(mesh.faces) != num_triangles:
        raise ValueError("Parsed STL triangle count does not match binary header")
    if num_triangles > max_faces * 2:
        raise ValueError(
            f"STL has {num_triangles} triangles, significantly above target {max_faces}; "
            "inspect Blender decimation"
        )
    return {"exported_triangle_count": num_triangles, "bounds_in_source_coordinates": bounds.tolist()}


def build_stl(output_path: Path, max_faces: int, blender_executable: str) -> dict[str, object]:
    """Use Blender's glTF importer to preserve decoded geometry before STL conversion."""
    source = download_glb()
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        glb = temp / "nasa-original.glb"
        glb.write_bytes(source)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            blender_executable,
            "--background",
            "--python",
            str(BLENDER_SCRIPT.resolve()),
            "--",
            str(glb),
            str(output_path.resolve()),
            str(max_faces),
        ]
        subprocess.run(command, check=True, timeout=900)
    geometry = json.loads(output_path.with_suffix(".geometry.json").read_text(encoding="utf-8"))
    checked = validate_stl(output_path, max_faces)
    binary = output_path.read_bytes()
    metadata = {
        "asset_name": "NASA RASSOR visual reference",
        "original_source_url": SOURCE_URL,
        "nasa_catalog": "https://science.nasa.gov/3d-resources/regolith-advanced-surface-systems-operations-robot-rassor/",
        "source_credit": CREDIT,
        "source_format": "GLB",
        "derived_format": "STL (binary)",
        "source_bytes": len(source),
        "source_sha256": sha256(source),
        "original_triangle_count": geometry["original_triangle_count"],
        "exported_triangle_count": checked["exported_triangle_count"],
        "max_triangle_target": max_faces,
        "output_bytes": len(binary),
        "output_sha256": sha256(binary),
        "bounds_in_source_coordinates": checked["bounds_in_source_coordinates"],
        "blender_version": geometry["blender_version"],
        "mesh_object_count": geometry["mesh_object_count"],
        "notes": [
            "Converted/decimated reference mesh; not independently engineered.",
            "STL discards materials, textures, hierarchy, joints, rigging and physical validity.",
            "Dimensions/origin of NASA source not confirmed as a real RASSOR hardware specification.",
            "Do not claim this STL is NASA-certified, printable, manufacturable or functional.",
            "NASA acknowledgment required; no NASA endorsement implied.",
        ],
    }
    output_path.with_suffix(".geometry.json").unlink(missing_ok=True)
    output_path.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    return metadata


def main() -> None:
    """Run CLI conversion with bounded target size and explicit Blender path."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT_DEFAULT)
    parser.add_argument("--max-faces", type=int, default=250_000)
    parser.add_argument("--blender", default="blender")
    options = parser.parse_args()
    if options.max_faces < 1000:
        parser.error("--max-faces must be >= 1000")
    report = build_stl(options.output, options.max_faces, options.blender)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
