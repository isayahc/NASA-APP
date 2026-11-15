"""Shared assumed dimensions and named assembly layout for ASSET-01."""

from __future__ import annotations

import math
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Parameters(BaseModel):
    """Concept inputs, all engineering assumptions rather than NASA measurements."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    revision: int = Field(ge=1)
    chassis_width_mm: float = Field(gt=0)
    chassis_length_mm: float = Field(gt=0)
    chassis_height_mm: float = Field(gt=0)
    ground_clearance_mm: float = Field(gt=0)
    wheel_radius_mm: float = Field(gt=0)
    wheel_width_mm: float = Field(gt=0)
    wheelbase_mm: float = Field(gt=0)
    wheel_track_mm: float = Field(gt=0)
    drum_radius_mm: float = Field(gt=0)
    drum_width_mm: float = Field(gt=0)
    drum_wall_mm: float = Field(gt=0)
    drum_offset_mm: float = Field(gt=0)
    drum_center_height_mm: float = Field(gt=0)
    scoops_per_drum: int = Field(ge=4, le=16)
    scoop_width_mm: float = Field(gt=0)
    scoop_depth_mm: float = Field(gt=0)
    arm_pivot_offset_mm: float = Field(gt=0)
    arm_pivot_height_mm: float = Field(gt=0)
    arm_lift_deg: float = Field(gt=0, le=85)
    bucket_capacity_l_per_drum: float = Field(gt=0)
    payload_kg: float = Field(gt=0)

    @model_validator(mode="after")
    def geometric_limits(self) -> Parameters:
        """Reject impossible cavity, ground, wheel and drum envelopes early."""
        if self.drum_wall_mm >= min(self.drum_radius_mm, self.drum_width_mm / 2):
            raise ValueError("Drum wall eliminates the payload cavity")
        if self.scoop_width_mm >= self.drum_width_mm - 2 * self.drum_wall_mm:
            raise ValueError("Scoop exceeds drum cavity width")
        outer_radius = math.hypot(self.drum_radius_mm + self.scoop_depth_mm, 65)
        if self.drum_center_height_mm < outer_radius:
            raise ValueError("Resting scoop envelope intersects the ground")
        if self.drum_offset_mm - outer_radius <= self.chassis_length_mm / 2:
            raise ValueError("Drum envelope overlaps the chassis")
        if self.wheel_track_mm - self.wheel_width_mm <= self.chassis_width_mm:
            raise ValueError("Wheel envelopes overlap the chassis")
        if self.arm_pivot_offset_mm >= self.drum_offset_mm:
            raise ValueError("Arm pivot must be inboard of its drum")
        cavity_l = math.pi * (self.drum_radius_mm - self.drum_wall_mm) ** 2 * (
            self.drum_width_mm - 2 * self.drum_wall_mm
        ) / 1e6
        if self.bucket_capacity_l_per_drum > cavity_l:
            raise ValueError("Assumed working capacity exceeds cylindrical cavity")
        return self


def load_parameters() -> Parameters:
    """Load the adjacent editable, unit-bearing parameter file."""
    return Parameters.model_validate_json(Path(__file__).with_name("parameters.json").read_text())


def layout(p: Parameters) -> tuple[list[dict], list[dict], dict]:
    """Return CAD recipes, joint definitions and body-local attachment frames.

    World/rest frame: millimeters, X width, +Y forward, +Z up, ground Z=0.
    dig_tool_l/r designate the two opposed tool assemblies (front/rear).
    """
    bodies: list[dict] = []
    joints: list[dict] = []

    def add(ref: str, kind: str, center: list[float], size: list[float], **extra) -> None:
        bodies.append(dict(ref=ref, kind=kind, center=center, size=size, **extra))

    def joint(ref: str, parent: str, pivot: list[float], *, axis=None, limit=0) -> None:
        joints.append(dict(id=f"joint_{ref}", child=ref, parent=parent,
                           type="revolute" if limit else "fixed", pivot=pivot,
                           axis=axis or [1, 0, 0], upper_deg=limit))

    cz = p.ground_clearance_mm + p.chassis_height_mm / 2
    add("chassis", "chassis", [0, 0, cz],
        [p.chassis_width_mm, p.chassis_length_mm, p.chassis_height_mm])
    add("equipment_deck", "box", [0, 0, cz + p.chassis_height_mm / 2 + 35], [620, 700, 70])
    joint("equipment_deck", "chassis", [0, 0, cz])
    for side, xs in (("l", -1), ("r", 1)):
        for end, ys in (("front", 1), ("rear", -1)):
            center = [xs * p.wheel_track_mm / 2, ys * p.wheelbase_mm / 2, p.wheel_radius_mm]
            ref = f"wheel_{side}_{end}"
            add(ref, "wheel", center, [p.wheel_width_mm, 2*p.wheel_radius_mm, 2*p.wheel_radius_mm])
            joint(ref, "chassis", center, limit=360)
            hub = f"drive_{side}_{end}"
            add(hub, "cylinder", [xs * (p.chassis_width_mm / 2 + 65), center[1], center[2]], [130, 140, 140])
            joint(hub, "chassis", center)

    frames = {"base": {"body": "chassis", "origin_mm": [0, 0, 0], "axes": "X width, Y forward, Z up"}}
    for tool, sign in (("l", 1), ("r", -1)):
        pivot = [0, sign * p.arm_pivot_offset_mm, p.arm_pivot_height_mm]
        center = [0, sign * p.drum_offset_mm, p.drum_center_height_mm]
        arm_ref, drum_ref = f"arm_{tool}", f"drum_{tool}"
        arm_center = [0, (pivot[1]+center[1])/2, (pivot[2]+center[2])/2]
        add(arm_ref, "arm", arm_center, [p.drum_width_mm+100,
            p.drum_offset_mm-p.arm_pivot_offset_mm+70,
            abs(p.arm_pivot_height_mm-p.drum_center_height_mm)+70], pivot=pivot, end=center)
        joint(arm_ref, "chassis", pivot, axis=[sign, 0, 0], limit=p.arm_lift_deg)
        add(f"pivot_{tool}", "cylinder", pivot, [p.drum_width_mm+110, 90, 90])
        joint(f"pivot_{tool}", "chassis", pivot)
        add(drum_ref, "drum", center, [p.drum_width_mm, 2*p.drum_radius_mm, 2*p.drum_radius_mm], sign=sign)
        joint(drum_ref, arm_ref, center, axis=[sign, 0, 0], limit=360)
        for i in range(p.scoops_per_drum):
            angle = 2 * math.pi * i / p.scoops_per_drum
            ref = f"scoop_{tool}_{i+1:02d}"
            # Actual bounds are measured from native CAD; this is an authoring envelope.
            add(ref, "scoop", center, [p.scoop_width_mm, 2*(p.drum_radius_mm+p.scoop_depth_mm),
                2*(p.drum_radius_mm+p.scoop_depth_mm)], angle=angle, sign=sign)
            joint(ref, drum_ref, center)
        for name in (f"dig_tool_{tool}", f"payload_{tool}"):
            frames[name] = {"body": drum_ref, "origin_mm": center, "axes": "X drum axis, Y forward, Z up; rest coordinates"}

    # A separately selectable open alignment bracket, not a pipe carrying regolith.
    center = [0, p.chassis_length_mm/2+30, cz+100]
    add("dump_port", "dump_port", center, [220, 60, 100])
    joint("dump_port", "chassis", center)
    frames["dump_frame"] = {"body": "dump_port", "origin_mm": center, "axes": "+Y outward approach normal, +Z up"}
    return bodies, joints, frames
