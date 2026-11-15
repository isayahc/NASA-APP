"""Build a native Forma product and STEP assembly using the pinned CAD adapter."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from forma_core.domains.composition import ProductBundle
from forma_core.domains.storage import save_product
from forma_core.domains.tools import call_domain_tool

from design import layout, load_parameters

ROOT = Path(__file__).resolve().parent
FORMA_REV = "694c53800974747d1c472da34a905db90366081a"
CAD_REV = "9c0c6dc0b5794debdfb8c7507078bae3303dd8bd"
CAD_REQUIREMENT = f"opencad[occt] @ git+https://github.com/Mapped-Assembly/OpenCAD.git@{CAD_REV}#subdirectory=packages/opencad"


def write_json(path: Path, value: object) -> None:
    """Write portable JSON with finite numbers and UTF-8 encoding."""
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def vector(values: list[float]) -> dict[str, float]:
    """Convert an XYZ vector to Forma's millimeter vocabulary."""
    return dict(zip(("x_mm", "y_mm", "z_mm"), values))


def build(forma_source: Path, output: Path) -> None:
    """Compile geometry, validate native IR, and persist a revisioned product."""
    revision = subprocess.check_output(["git", "-C", str(forma_source), "rev-parse", "HEAD"], text=True).strip()
    if revision != FORMA_REV:
        raise ValueError(f"Expected OpenForma {FORMA_REV}, found {revision}")
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Use a fresh output directory for each engineering build/revision")
    p = load_parameters()
    bodies, joints, frames = layout(p)
    adapter = forma_source / ".agents/skills/forma-hardware/scripts/cad.py"
    command = [sys.executable, str(adapter), "build", str(ROOT / "assembly.py"),
               str(output / "excavator.step"), "--tree-output", str(output / "excavator.tree.json"),
               "--requirement", CAD_REQUIREMENT]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    summary = json.loads(result.stdout)
    if not summary.get("valid"):
        raise ValueError("Forma CAD adapter did not validate the exported file")
    meshes = summary.pop("articulated_bodies")
    kinematics = summary.pop("kinematics")
    write_json(output / "excavator.meshes.json", meshes)
    write_json(output / "excavator.kinematics.json", kinematics)
    mesh_by_ref = {mesh["ref_des"]: mesh for mesh in meshes}
    placements = []
    part_definitions = []
    for body in bodies:
        mesh = mesh_by_ref[body["ref"]]["mesh"]
        vertices = mesh["vertices"]
        # OpenCAD TriangleMesh serializes vertices as a flat XYZ scalar array.
        lo = [min(vertices[i::3]) for i in range(3)]
        hi = [max(vertices[i::3]) for i in range(3)]
        size = [hi[i]-lo[i] for i in range(3)]
        center = [(hi[i]+lo[i])/2 for i in range(3)]
        placements.append({"ref_des": body["ref"], "label": body["ref"].replace("_", " "),
                           "category": "Mechanical", "layer": "mechanism", "position": vector(center),
                           "size": vector(size), "notes": "Native mesh bounds in ground-centered rest frame; mm."})
        part_definitions.append({"part_definition_id": "part_"+body["ref"],
                                 "dimensions_mm": dict(zip(("width", "depth", "height"), size)),
                                 "geometry_refs": [f"excavator.meshes.json#{body['ref']}"]})
    motions = [{"motion_id": j["id"], "label": j["id"], "type": "revolute",
                "target_ref": j["child"], "parent_ref": j["parent"], "axis": "X",
                "pivot_mm": j["pivot"], "min_deg": 0 if j["axis"][0] > 0 else -j["upper_deg"],
                "max_deg": j["upper_deg"] if j["axis"][0] > 0 else 0,
                "notes": "Signed +X angular range; OpenCAD uses signed axis and nonnegative travel. Rest is zero."}
               for j in joints if j["type"] == "revolute"]
    document = {
        "domain": "mechanical", "schema_version": "1.0", "artifact_id": "ASSET-01-mechanical",
        "revision": p.revision, "parts": part_definitions,
        "components": [{"object_id": "ASSET-01/"+b["ref"], "ref_des": b["ref"],
                        "part_definition_id": "part_"+b["ref"]} for b in bodies],
        "mechanical": {
            "physical_form": "Four-wheel rover with opposed front/rear hollow bucket drums and forked lift arms",
            "enclosure_type": "Concept chassis; hollow metallic housing",
            "mounting_guidance": "Z-up mm; +Y forward. Named joints and frames accompany STEP and separate meshes.",
            "manufacturability_rating": "Not evaluated",
            "fabrication_details": ["All dimensions, payload and volume limits are engineering assumptions.",
                                    "No structural, thermal, drive sizing, soil interaction or manufacturing verification."],
            "component_placements": placements, "motion_intents": motions,
            "cad_sources": [{"name": "NASA RASSOR geometric/task reference", "source_type": "Reference CAD",
                             "url": "https://science.nasa.gov/3d-resources/regolith-advanced-surface-systems-operations-robot-rassor/",
                             "file_formats": ["GLB"], "notes": "Original new parametric model, not a copy of NASA dimensions."}]
        },
        "cad_model": {"source": "OpenCAD", "model_path": "../source/assembly.py", "step": "excavator.step",
                      "meshes": "excavator.meshes.json", "kinematics": "excavator.kinematics.json"}
    }
    validation = call_domain_tool("validate-domain", document)
    if not validation["is_valid"]:
        raise ValueError(validation)
    product = call_domain_tool("compose", {"product_id": "ASSET-01", "documents": [document]})
    product_validation = call_domain_tool("validate", product)
    if not product_validation["is_valid"]:
        raise ValueError(product_validation)
    write_json(output / "mechanical.ir.json", document)
    save_product(ProductBundle.model_validate(product), output / "forma.product.json")
    write_json(output / "frames.json", {"units": "mm", "coordinate_system": "z-up", "frames": frames,
               "semantics": "Origins are in modeled rest/world coordinates. Apply owning body's evaluated transform; not COM-relative offsets."})
    write_json(output / "validation.json", {"mechanical": validation, "product": product_validation,
               "cad": {k: v for k, v in summary.items() if k not in {"model_path", "tree_path", "path"}},
               "scope": "Schema, references and native CAD export only; not excavation physics or factory operation."})
    provenance = {
        "asset_id": "ASSET-01", "revision": p.revision, "authoring_agent": "opencode",
        "openforma": {"repository": "https://github.com/Mapped-Assembly/OpenForma", "revision": FORMA_REV},
        "opencad": {"repository": "https://github.com/Mapped-Assembly/OpenCAD", "revision": CAD_REV},
        "parameters": p.model_dump(), "parameter_provenance": "All numerical inputs are uncalibrated design assumptions.",
        "working_capacity": "30 L per drum and 40 kg total are independent assumed limits, not computed regolith payload.",
        "source_brief": "../brief.md",
        "limitations": ["No OI runtime/task/controller binding yet", "No material transfer or power simulation",
                        "No collision-free sweep or structural qualification", "No electrical drive specification",
                        "Kinematics tracks are design inspection samples, not a dig/haul/dump execution"],
        "sha256": {path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else path.name:
                   hashlib.sha256(path.read_bytes()).hexdigest()
                   for path in [ROOT / "assembly.py", ROOT / "design.py", ROOT / "parameters.json", ROOT / "build.py",
                                *sorted(output.glob("*.json")), output / "excavator.step"]}
    }
    write_json(output / "provenance.json", provenance)
    print(f"Built {len(bodies)} selectable bodies and {len(motions)} driven joints: {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--forma-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT.parent / "artifacts")
    args = parser.parse_args()
    build(args.forma_source.resolve(), args.output.resolve())
