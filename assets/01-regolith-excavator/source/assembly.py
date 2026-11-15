"""Parametric ASSET-01 geometry executed by Forma's native OpenCAD adapter."""

from __future__ import annotations

import math

from opencad import Part, Sketch
from opencad.runtime import get_default_context

from design import layout, load_parameters


def prism_x(points: list[tuple[float, float]], width: float, name: str) -> Part:
    """Extrude a YZ polygon symmetrically along X, in millimeters."""
    sketch = Sketch(plane="YZ", name=name + " profile")
    for a, b in zip(points, points[1:] + points[:1]):
        sketch.line(a, b)
    return Part().extrude(sketch, depth=width / 2, both=True, name=name)


def cylinder_x(radius: float, width: float, name: str) -> Part:
    """Create a cylinder centered at the origin with its axis along X."""
    return Part().extrude(Sketch(plane="YZ").circle(radius), depth=width/2, both=True, name=name)


def radial_box(r0: float, r1: float, t0: float, t1: float, angle: float,
               width: float, name: str) -> Part:
    """Create a rotated rectangular prism in the drum's radial/tangential frame."""
    c, s = math.cos(angle), math.sin(angle)
    return prism_x([(r*c-t*s, r*s+t*c) for r, t in
                    ((r0, t0), (r1, t0), (r1, t1), (r0, t1))], width, name)


p = load_parameters()
bodies, joint_specs, frames = layout(p)
parts: dict[str, Part] = {}
FORMA_PREVIEW_BODIES = []

for body in bodies:
    ref, kind = body["ref"], body["kind"]
    x, y, z = body["center"]
    sx, sy, sz = body["size"]
    if kind == "chassis":
        part = Part().box(sx, sy, sz, name="Chassis housing")
        part.cut(Part().box(sx-16, sy-16, sz-16), name="Hollow equipment chassis")
    elif kind == "box":
        part = Part().box(sx, sy, sz, name=ref)
    elif kind == "dump_port":
        part = Part().box(sx, sy, sz, name=ref)
        part.cut(Part().box(sx-20, sy+2, sz-20), name="Open docking alignment bracket")
    elif kind in {"wheel", "cylinder"}:
        part = cylinder_x(sy/2, sx, ref)
        if kind == "wheel":
            part.cut(cylinder_x(sy/2-30, sx+2, ref+" rim cavity"))
            for i in range(6):
                part.union(radial_box(55, sy/2-20, -12, 12, i*math.pi/3, sx-30, ref+" spoke"))
                if i == 0:
                    part.union(cylinder_x(65, sx, ref+" hub"))
            for i in range(16):
                part.union(radial_box(sy/2-6, sy/2, -9, 9, i*math.pi/8, sx+10, ref+" grouser"))
    elif kind == "arm":
        py, pz = body["pivot"][1:]
        ey, ez = body["end"][1:]
        dy, dz = ey-py, ez-pz
        length = math.hypot(dy, dz)
        ny, nz = -dz/length*30, dy/length*30
        points = [(py-y+ny, pz-z+nz), (ey-y+ny, ez-z+nz),
                  (ey-y-ny, ez-z-nz), (py-y-ny, pz-z-nz)]
        offset = p.drum_width_mm/2+30
        part = prism_x(points, 40, ref+" left rail").translate((-offset, 0, 0))
        part.union(cylinder_x(32, 2*offset+40, ref+" pivot cross shaft").translate((0, py-y, pz-z)))
        part.union(prism_x(points, 40, ref+" right rail").translate((offset, 0, 0)))
        part.union(cylinder_x(30, 2*offset+40, ref+" drum axle").translate((0, ey-y, ez-z)))
    elif kind == "drum":
        part = cylinder_x(p.drum_radius_mm, p.drum_width_mm, ref)
        part.cut(cylinder_x(p.drum_radius_mm-p.drum_wall_mm,
                            p.drum_width_mm-2*p.drum_wall_mm, ref+" payload cavity"))
        part.cut(cylinder_x(32, p.drum_width_mm+2, ref+" axle bore"))
        for i in range(p.scoops_per_drum):
            part.cut(radial_box(p.drum_radius_mm-20, p.drum_radius_mm+10, -45, 45,
                               i*2*math.pi/p.scoops_per_drum, p.scoop_width_mm-20, ref+" intake slot"))
    elif kind == "scoop":
        angle, sign = body["angle"], body["sign"]
        part = radial_box(p.drum_radius_mm-15, p.drum_radius_mm+p.scoop_depth_mm,
                          -65, 65, angle, p.scoop_width_mm, ref)
        t0, t1 = (-55, 70) if sign == 1 else (-70, 55)
        part.cut(radial_box(p.drum_radius_mm-8, p.drum_radius_mm+p.scoop_depth_mm+5,
                            t0, t1, angle, p.scoop_width_mm-16, ref+" open pocket"))
    else:
        raise ValueError(f"Unknown body recipe: {kind}")
    part.translate((x, y, z), name=ref)
    parts[ref] = part
    FORMA_PREVIEW_BODIES.append({"shape_id": part.shape_id, "name": ref, "ref_des": ref})

context = get_default_context()
for spec in joint_specs:
    result = context.registry.call("create_kinematic_joint", {
        "joint_id": spec["id"], "type": spec["type"],
        "parent_shape_id": parts[spec["parent"]].shape_id,
        "child_shape_id": parts[spec["child"]].shape_id,
        "axis": spec["axis"], "origin_mm": spec["pivot"],
        "lower_limit": 0, "upper_limit": math.radians(spec["upper_deg"]),
        "label": spec["id"], "metadata": {
            "forma_target_ref": spec["child"], "forma_parent_ref": spec["parent"],
            "notes": "Design kinematics only; runtime must command joints from accepted machine tasks."
        }
    })
    if not result.ok:
        raise RuntimeError(result.message)

# Export every final body, retaining separate selectable solids and mesh identities.
FORMA_EXPORT_SHAPE_IDS = [part.shape_id for part in parts.values()]
