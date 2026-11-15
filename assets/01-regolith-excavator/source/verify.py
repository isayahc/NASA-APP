"""Verify generated body identity, articulation and export integrity offline."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from opencad.kernel.core.models import KinematicJoint
from opencad.kinematics import evaluate_assembly_pose

from design import layout, load_parameters


def verify(directory: Path) -> None:
    """Check content hashes, body coverage and opposed drum/arm transformations."""
    load = lambda name: json.loads((directory / name).read_text(encoding="utf-8"))
    p = load_parameters()
    bodies, _, frames = layout(p)
    meshes = load("excavator.meshes.json")
    assert {b["ref"] for b in bodies} == {b["ref_des"] for b in meshes}
    assert len(meshes) == len({b["shape_id"] for b in meshes})
    by_ref = {m["ref_des"]: m["shape_id"] for m in meshes}
    for mesh in meshes:
        vertices, faces = mesh["mesh"]["vertices"], mesh["mesh"]["faces"]
        assert vertices and faces and len(vertices) % 3 == 0 and len(faces) % 3 == 0
        assert all(math.isfinite(v) for v in vertices)
        assert all(0 <= i < len(vertices)//3 for i in faces)
    assert {"base", "dig_tool_l", "dig_tool_r", "payload_l", "payload_r", "dump_frame"} == set(frames)
    tracks = load("excavator.kinematics.json")["tracks"]
    joints = [KinematicJoint.model_validate(t["joint"]) for t in tracks]
    rest = evaluate_assembly_pose(joints, {})
    for pose in rest.values():
        assert all(abs(x) < 1e-8 for x in pose.translation_mm)
        assert abs(pose.rotation_quaternion_xyzw[3]-1) < 1e-8
    pose = evaluate_assembly_pose(joints, {"joint_drum_l": 0.25, "joint_drum_r": 0.25})
    left, right = (pose[by_ref["drum_"+side]] for side in ("l", "r"))
    assert math.isclose(left.rotation_quaternion_xyzw[0], -right.rotation_quaternion_xyzw[0])
    raised = evaluate_assembly_pose(joints, {"joint_arm_l": 1, "joint_arm_r": 1})
    for side in ("l", "r"):
        assert raised[by_ref["drum_"+side]] == raised[by_ref["scoop_"+side+"_01"]]
        assert raised[by_ref["drum_"+side]] != rest[by_ref["drum_"+side]]
    for name, digest in load("provenance.json")["sha256"].items():
        # Original source paths/hashes predate the layout migration. Validate the
        # unchanged generated artifacts here, not subsequently maintained scripts.
        candidate = directory / Path(name).name
        if candidate.is_file():
            assert hashlib.sha256(candidate.read_bytes()).hexdigest() == digest, name
    assert load("validation.json")["mechanical"]["is_valid"]
    assert load("validation.json")["product"]["is_valid"]
    print(f"Verified {len(meshes)} meshes, {len(joints)} joints, six frames, opposite drum rotations, inherited arm motion, and file hashes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    verify(parser.parse_args().directory.resolve())
