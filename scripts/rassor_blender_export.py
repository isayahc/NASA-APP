"""Blender-only conversion of NASA's RASSOR GLB to flattened reference STL.

Invoked by scripts/import_rassor.py as:
    blender --background --python scripts/rassor_blender_export.py -- input.glb output.stl 250000
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main() -> None:
    """Import GLB with Blender's glTF decoder, validate geometry and export STL."""
    argv = sys.argv[sys.argv.index("--") + 1 :]
    if len(argv) != 3:
        raise SystemExit("usage: blender ... -- source.glb output.stl max_faces")
    source, output, max_faces_text = argv
    max_faces = int(max_faces_text)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(Path(source).resolve()))

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.polygons) > 0]
    if not meshes:
        raise RuntimeError("GLB importer produced no nonempty mesh objects; cannot export STL")

    original_triangles = sum(
        sum(max(0, len(face.vertices) - 2) for face in obj.data.polygons) for obj in meshes
    )
    bounds_min = [math.inf] * 3
    bounds_max = [-math.inf] * 3
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                bounds_min[axis] = min(bounds_min[axis], float(world[axis]))
                bounds_max[axis] = max(bounds_max[axis], float(world[axis]))

    spans = [hi - lo for lo, hi in zip(bounds_min, bounds_max)]
    if not all(math.isfinite(x) for x in bounds_min + bounds_max):
        raise ValueError("Imported RASSOR mesh bounds are not finite")
    if max(spans) <= 1e-5:
        raise ValueError(f"Imported RASSOR mesh is degenerate: bounds {bounds_min} .. {bounds_max}")

    # Importer may create hundreds of discrete parts. Decimate each object with a
    # consistent ratio, maintaining its transform and skipping very small pieces.
    if original_triangles > max_faces:
        ratio = max_faces / original_triangles
        for obj in meshes:
            if len(obj.data.polygons) < 40:
                continue
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new(name="Reference mesh reduction", type="DECIMATE")
            modifier.ratio = max(0.001, min(1.0, ratio))
            bpy.ops.object.modifier_apply(modifier=modifier.name)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    output_path = Path(output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if hasattr(bpy.ops.wm, "stl_export"):
        bpy.ops.wm.stl_export(filepath=str(output_path), export_selected_objects=True, ascii_format=False)
    else:
        bpy.ops.export_mesh.stl(filepath=str(output_path), use_selection=True, ascii=False)

    result = {
        "blender_version": bpy.app.version_string,
        "mesh_object_count": len(meshes),
        "original_triangle_count": original_triangles,
        "bounds_in_source_coordinates": [bounds_min, bounds_max],
        "decimation_target": max_faces,
    }
    meta_path = output_path.with_suffix(".geometry.json")
    meta_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("RASSOR_GEO_REPORT=" + json.dumps(result))


if __name__ == "__main__":
    main()
