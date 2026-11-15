"""Build the remaining brief-driven CAD concepts, compile via Forma MCP, render GIFs."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import sys

import cadquery as cq
import numpy as np
from opencad import Part
from opencad.kernel.core.backend_factory import create_backend
from opencad.kernel.core.models import KinematicJoint
from opencad.runtime import RuntimeContext, set_default_context
from forma_core.domains.tools import call_domain_tool

ROOT = Path(__file__).resolve().parents[1]
from compile_excavator import rpc
from render_gif import render

SILVER = [0.70, 0.78, 0.84]
BLUE = [0.16, 0.48, 0.66]
GOLD = [0.92, 0.58, 0.18]
DARK = [0.22, 0.29, 0.36]
WHITE = [0.88, 0.91, 0.91]
TITLES = {
    2: "REGOLITH HOPPER & FEEDER", 3: "PREHEATING AUGER",
    4: "MRE ELECTROLYSIS REACTOR", 5: "GAS CAPTURE & MONITORING",
    6: "OXYGEN PURIFICATION", 7: "OXYGEN GAS STORAGE",
    8: "POWER GENERATION & DISTRIBUTION", 9: "THERMAL CONTROL & RADIATORS",
    10: "SLAG & BYPRODUCT RECEIVER", 11: "CRYOGENIC OXYGEN DEPOT",
}


class Machine:
    """Named native solids with explicit rest-frame mechanical joints."""

    def __init__(self, number: int) -> None:
        self.number = number
        self.context = RuntimeContext(backend=create_backend("occt", require_native=True))
        set_default_context(self.context)
        self.parts: list[dict] = []
        self.joints: list[dict] = []

    def add(self, name: str, part: Part | cq.Shape, pos=(0, 0, 0), color=SILVER,
            axis="Z", motion=None) -> cq.Shape:
        """Place a native solid; optional motion is (axis, pivot, degrees)."""
        name = name.replace("-", "neg")
        shape = cq.Shape(self.context.kernel.get_native_shape(part.shape_id)) if isinstance(part, Part) else part
        if axis == "X":
            shape = shape.rotate((0, 0, 0), (0, 1, 0), 90)
        elif axis == "Y":
            shape = shape.rotate((0, 0, 0), (1, 0, 0), 90)
        shape = shape.translate(pos)
        if not shape.isValid():
            raise ValueError(f"Invalid native shape: {name}")
        self.parts.append(dict(name=name, shape=shape, color=color))
        if motion:
            vector, pivot, degrees = motion
            if degrees < 0:
                vector = tuple(-v for v in vector)
                degrees = -degrees
            self.joints.append(dict(id=("spin_" if degrees == 360 else "move_")+name,
                type="revolute", parent_shape_id="support", child_shape_id=name,
                axis=vector, origin_mm=pivot, lower_limit=0,
                upper_limit=math.radians(degrees), label=name))
        return shape

    def box(self, name: str, size, pos, color=SILVER, motion=None) -> cq.Shape:
        """Create an OpenCAD box."""
        return self.add(name, Part().box(*size), pos, color, motion=motion)

    def tube(self, name: str, radius: float, length: float, pos, color=SILVER,
             axis="Z", wall=8, cutaway=False, motion=None) -> cq.Shape:
        """Create a centered hollow OpenCAD cylinder, optionally sectioned for inspection."""
        part = Part().cylinder(radius, length)
        # OpenCAD cylinders originate at z=0; center explicitly.
        part.translate((0, 0, -length/2))
        part.cut(Part().cylinder(radius-wall, length+2).translate((0, 0, -length/2-1)))
        if cutaway:
            part.cut(Part().box(radius*2+2, radius+2, length+2).translate((0, -radius/2-1, 0)))
        return self.add(name, part, pos, color, axis, motion)

    def cylinder(self, name: str, radius: float, length: float, pos, color=SILVER,
                 axis="Z", motion=None) -> cq.Shape:
        """Create a centered solid cylinder."""
        return self.add(name, Part().cylinder(radius, length).translate((0, 0, -length/2)), pos, color, axis, motion)

    def base(self, x=1800, y=1200) -> None:
        """Create support skid and four feet."""
        self.box("support", (x, y, 100), (0, 0, 100), DARK)
        for i, (a, b) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
            self.box(f"foot_{i}", (140, 140, 100), (a*(x/2-120), b*(y/2-120), 25), DARK)

    def valve(self, name: str, pos) -> None:
        """Create a pipe valve body and quarter-turn inspection handle."""
        x, y, z = pos
        self.cylinder(name+"_body", 55, 160, pos, BLUE, "X")
        self.cylinder(name+"_stem", 16, 90, (x, y, z+60), SILVER)
        self.box(name+"_handle", (170, 24, 22), (x+55, y, z+115), GOLD,
                 motion=((0, 0, 1), (x, y, z+115), 90))

    def screw(self, name: str, length: float, radius: float, pitch: float, pos) -> None:
        """Build an actual helical swept flight and shaft, rotating about X."""
        motion = ((1, 0, 0), pos, 360)
        self.cylinder(name+"_shaft", 35, length, pos, BLUE, "X", motion)
        helix = cq.Wire.makeHelix(pitch, length-60, radius)
        # A radial rectangular section is swept through the full helix.
        flight = (cq.Workplane("XZ").center((radius+35)/2, 0)
                  .rect(radius-35, 10).sweep(cq.Workplane(obj=helix), isFrenet=True).val())
        flight = flight.translate((0, 0, -(length-60)/2))
        self.add(name+"_flight", flight, pos, GOLD, "X", motion)


def design(n: int) -> Machine:
    """Author distinct geometry from each subsystem's stated build brief."""
    m = Machine(n)
    m.base(2400 if n in (2, 3, 8, 9, 11) else 1800, 1400)
    if n == 2:
        hopper = (cq.Workplane("XY").workplane(offset=850).rect(300, 300)
                  .workplane(offset=650).rect(1000, 1000).loft(combine=True)
                  .faces(">Z").shell(-12).val())
        m.add("hopper_shell", hopper, (-500, 0, 0))
        m.box("inlet_rim", (1080, 40, 50), (-500, 500, 1520), BLUE)
        for i, x in enumerate((-950, -50)):
            for j, y in enumerate((-450, 450)):
                m.box(f"support_leg_{i}_{j}", (70, 70, 1280), (x, y, 770), DARK)
        m.box("gate", (340, 340, 25), (-500, 0, 850), GOLD,
              motion=((1, 0, 0), (-500, -170, 850), 60))
        m.box("feed_chute", (300, 300, 230), (-500, 0, 700), SILVER)
        m.tube("feeder_trough_cutaway", 190, 1750, (150, 0, 480), cutaway=True, axis="X")
        m.screw("auger", 1750, 160, 270, (150, 0, 480))
        m.cylinder("drive", 150, 250, (-900, 0, 480), BLUE, "X")
        m.tube("outlet", 190, 100, (1060, 0, 480), BLUE, "X")
    elif n == 3:
        m.tube("shell_cutaway", 260, 1950, (0, 0, 720), axis="X", cutaway=True)
        m.tube("insulation_cutaway", 310, 1950, (0, 0, 720), WHITE, "X", 40, True)
        m.screw("auger", 1900, 220, 300, (0, 0, 720))
        for i, x in enumerate((-700, 0, 700)):
            m.tube(f"heater_zone_{i}_cutaway", 320, 250, (x, 0, 720), GOLD, "X", 12, True)
            m.cylinder(f"sensor_port_{i}", 24, 140, (x, 0, 1080), BLUE)
        for x in (-750, 750):
            m.box(f"mount_{x}", (120, 680, 310), (x, 0, 320), DARK)
        m.cylinder("drive", 190, 240, (-1130, 0, 720), BLUE, "X")
        m.tube("feed_inlet", 110, 300, (-750, 0, 1150))
        m.tube("hot_discharge", 110, 320, (830, 0, 360), GOLD)
    elif n == 4:
        m.tube("vessel_shell_cutaway", 560, 1050, (0, 0, 720), SILVER, wall=35, cutaway=True)
        m.tube("insulation_cutaway", 520, 990, (0, 0, 720), WHITE, wall=80, cutaway=True)
        m.tube("refractory_cutaway", 435, 920, (0, 0, 700), GOLD, wall=55, cutaway=True)
        m.cylinder("vessel_floor", 550, 90, (0, 0, 240), DARK)
        m.cylinder("gas_hood", 580, 120, (0, 0, 1310), SILVER)
        for name, x in (("anode", -200), ("cathode", 200)):
            m.box(name, (90, 180, 920), (x, 0, 980), DARK)
            m.box(name+"_busbar", (220, 100, 60), (x, 0, 1490), GOLD)
            m.cylinder(name+"_feedthrough", 85, 100, (x, 0, 1370), WHITE)
        m.tube("feed_port", 85, 330, (-380, 0, 1470), BLUE)
        m.tube("oxygen_outlet", 55, 420, (0, 300, 1570), BLUE)
        m.tube("slag_withdrawal", 75, 450, (620, 0, 380), GOLD, "X")
        m.valve("tap_gate", (700, 0, 380))
        m.box("inspection_panel", (350, 30, 470), (0, -570, 820), BLUE,
              motion=((0, 0, 1), (-175, -570, 820), -55))
        m.cylinder("thermal_probe", 22, 240, (380, 80, 1380), BLUE)
    elif n == 5:
        m.tube("capture_manifold", 55, 1500, (0, -270, 620), axis="X")
        for i, x in enumerate((-600, 0, 600)):
            m.valve(f"isolation_{i}", (x, -270, 620))
            m.tube(f"sample_riser_{i}", 22, 380, (x, -270, 900), BLUE)
            m.box(f"transducer_{i}", (120, 100, 110), (x, -270, 1120), GOLD)
        m.tube("sampling_bypass", 24, 1100, (0, 180, 940), BLUE, "X")
        for x in (-550, 550):
            m.tube(f"bypass_connection_{x}", 24, 450, (x, -45, 940), BLUE, "Y")
        m.box("instrument_rack", (850, 340, 950), (0, 430, 640), DARK)
        for i in range(3):
            m.box(f"analyzer_module_{i}", (770, 380, 220), (0, 430, 380+270*i), SILVER)
            m.box(f"instrument_face_{i}", (540, 12, 120), (0, 232, 380+270*i), BLUE)
        m.tube("purge_vent", 30, 750, (700, 200, 600), GOLD)
    elif n == 6:
        m.box("purifier_enclosure_cutaway", (850, 650, 80), (0, 0, 340), DARK)
        m.box("insulation_back", (850, 100, 1000), (0, 250, 860), WHITE)
        for x in (-420, 420):
            m.box(f"insulation_side_{x}", (100, 600, 1000), (x, 0, 860), WHITE)
        m.cylinder("ysz_service_cartridge", 230, 780, (0, 0, 840), GOLD)
        for z in (550, 800, 1050):
            m.tube(f"control_jacket_{z}", 270, 65, (0, 0, z), BLUE, wall=28)
        m.tube("feed_path", 45, 500, (-650, 0, 650), SILVER, "X")
        m.tube("recovered_o2_path", 40, 500, (650, 0, 1100), BLUE, "X")
        m.tube("reject_path", 35, 500, (650, 0, 480), GOLD, "X")
        m.valve("feed_valve", (-700, 0, 650))
        m.valve("product_valve", (700, 0, 1100))
        for x in (-130, 130):
            m.cylinder(f"electrical_terminal_{x}", 35, 200, (x, 0, 1320), SILVER)
        m.box("service_cover", (780, 45, 850), (0, -350, 870), BLUE,
              motion=((0, 0, 1), (-390, -350, 870), -60))
    elif n == 7:
        for i, x in enumerate((-550, 0, 550)):
            m.cylinder(f"vessel_{i}", 215, 1250, (x, 180, 940), SILVER)
            m.add(f"vessel_top_{i}", Part().sphere(215), (x, 180, 1565), SILVER)
            m.add(f"vessel_bottom_{i}", Part().sphere(215), (x, 180, 315), SILVER)
            m.tube(f"neck_{i}", 35, 240, (x, 180, 1840), BLUE)
            m.valve(f"valve_{i}", (x, 180, 1960))
            for z in (560, 1370):
                m.tube(f"restraint_{i}_{z}", 232, 70, (x, 180, z), BLUE, wall=12)
        m.tube("inlet_manifold", 35, 1450, (0, 180, 1960), BLUE, "X")
        m.box("compressor_optional", (600, 400, 420), (-350, -410, 380), DARK)
        m.cylinder("compressor_motor", 140, 300, (180, -410, 370), BLUE, "X")
        m.box("pressure_sensor", (180, 110, 200), (600, -420, 590), GOLD)
        m.tube("withdrawal_port", 40, 280, (650, -450, 290), SILVER, "X")
    elif n == 8:
        m.box("power_cabinet", (700, 700, 1000), (0, 0, 700), SILVER)
        m.box("converter", (500, 120, 280), (0, -415, 920), BLUE)
        m.box("dc_bus", (520, 60, 90), (0, -420, 630), GOLD)
        for i in range(6):
            m.box(f"battery_module_{i}", (310, 380, 120), (650, 0, 240+i*145), DARK)
            m.cylinder(f"load_port_{i}", 28, 50, (-230+i*90, -470, 440), GOLD, "Y")
        for sign in (-1, 1):
            pivot = (sign*450, 0, 1450)
            m.box(f"array_support_{sign}", (80, 80, 1250), (sign*450, 0, 780), DARK)
            m.cylinder(f"array_hinge_{sign}", 60, 1700, pivot, SILVER, "Y")
            motion = ((0, sign, 0), pivot, 45)
            m.box(f"array_frame_{sign}", (1500, 1700, 50), (sign*1200, 0, 1450), SILVER, motion)
            for i in range(5):
                for j in range(6):
                    m.box(f"solar_cell_{sign}_{i}_{j}", (275, 255, 12),
                          (sign*(510+i*295), -685+j*274, 1485), [0.06, 0.18, 0.38], motion)
    elif n == 9:
        m.box("heat_exchanger", (650, 550, 380), (-650, 0, 420), SILVER)
        m.cylinder("coolant_pump", 150, 380, (650, 0, 430), BLUE, "X")
        for y in (-370, 370):
            m.tube(f"thermal_line_{y}", 35, 1900, (0, y, 520), BLUE if y < 0 else GOLD, "X")
        for i, x in enumerate((-700, 0, 700)):
            pivot = (x, 0, 800)
            m.box(f"radiator_support_{i}", (80, 100, 650), (x, 0, 480), DARK)
            motion = ((1, 0, 0), pivot, 35)
            m.box(f"radiator_panel_{i}", (620, 80, 1800), (x, 0, 1700), WHITE, motion)
            m.cylinder(f"radiator_hinge_{i}", 55, 650, pivot, SILVER, "X")
            for j in range(7):
                m.cylinder(f"panel_loop_{i}_{j}", 12, 1700, (x-250+j*83, -55, 1700), BLUE, motion=motion)
        m.box("insulation_shroud", (350, 450, 250), (630, 0, 230), WHITE)
    elif n == 10:
        for name, x, y, sx, sy in (("receiver", -430, 0, 700, 650), ("slag_bin", 440, 250, 650, 650)):
            box = Part().box(sx, sy, 600)
            box.cut(Part().box(sx-50, sy-50, 600).translate((0, 0, 30)))
            m.add(name, box, (x, y, 480), SILVER)
        m.box("bin_lid", (700, 700, 50), (440, 250, 805), BLUE,
              motion=((1, 0, 0), (440, 600, 805), -55))
        m.box("cooling_tray", (650, 280, 55), (430, -430, 270), GOLD)
        m.tube("reactor_outlet", 85, 550, (-600, 0, 1300), GOLD, "X")
        m.box("tap_gate", (30, 190, 190), (-400, 0, 1300), BLUE,
              motion=((0, 1, 0), (-400, 0, 1395), 60))
        channel = Part().box(650, 250, 200)
        channel.cut(Part().box(660, 200, 200).translate((0, 0, 25)))
        m.add("casting_channel", channel, (-430, 0, 960), GOLD)
        m.box("service_port", (130, 50, 130), (-430, -350, 520), BLUE)
    elif n == 11:
        m.cylinder("tank_inner", 420, 1300, (250, 150, 1100), SILVER)
        m.tube("tank_vacuum_shell_cutaway", 530, 1450, (250, 150, 1100), SILVER, wall=18, cutaway=True)
        m.tube("multilayer_insulation_cutaway", 495, 1400, (250, 150, 1100), GOLD, wall=35, cutaway=True)
        for z in (370, 1830):
            m.cylinder(f"tank_cap_{z}", 530, 90, (250, 150, z), WHITE)
        m.box("cryocooler_cabinet", (480, 650, 1050), (-820, 0, 720), BLUE)
        m.cylinder("cold_head", 100, 370, (-500, 150, 1500), SILVER, "X")
        for i in range(9):
            m.tube(f"refrigeration_ring_{i}", 442, 25, (250, 150, 520+i*140), BLUE, wall=13, cutaway=True)
        m.tube("gas_conditioning_inlet", 45, 1600, (0, -480, 650), BLUE, "X")
        m.valve("inlet_valve", (-650, -480, 650))
        m.tube("vent_relief", 35, 350, (250, 150, 2060), GOLD)
        m.box("instrumentation", (260, 100, 240), (650, -470, 1100), DARK)
        m.tube("future_transfer_port", 50, 300, (900, 150, 500), SILVER, "X")
    return m


def build(n: int) -> None:
    """Export/validate a machine, persist its MCP response, then render once."""
    asset = next(ROOT.glob(f"{n:02d}-*"))
    directory = asset / "artifacts"
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "mcp-response.json").exists():
        raise ValueError(f"Existing MCP response for {n}; inspect before resubmitting")
    machine = design(n)
    compound = cq.Compound.makeCompound([p["shape"] for p in machine.parts])
    cq.exporters.export(compound, str(directory / "assembly.step"))
    meshes, definitions, components, placements = [], [], [], []
    for part in machine.parts:
        name, shape = part["name"], part["shape"]
        vertices, triangles = shape.tessellate(1.5, 0.18)
        flat = [float(c) for v in vertices for c in v.toTuple()]
        mesh = dict(ref_des=name, shape_id=name, name=name, units="mm", color=part["color"],
                    mesh={"vertices": flat, "faces": [i for t in triangles for i in t]})
        meshes.append(mesh)
        bound = shape.BoundingBox()
        size = [bound.xlen, bound.ylen, bound.zlen]
        center = [(bound.xmax+bound.xmin)/2, (bound.ymax+bound.ymin)/2, (bound.zmax+bound.zmin)/2]
        definitions.append(dict(part_definition_id=name, dimensions_mm=dict(zip(("x", "y", "z"), size))))
        components.append(dict(object_id=f"ASSET-{n:02d}/{name}", ref_des=name, part_definition_id=name))
        vec = lambda v: dict(zip(("x_mm", "y_mm", "z_mm"), v))
        placements.append(dict(ref_des=name, position=vec(center), size=vec(size), layer="mechanism"))
    joints = [KinematicJoint.model_validate(j).model_dump(mode="json") for j in machine.joints]
    def save(name, data):
        (directory / name).write_text(json.dumps(data, indent=2)+"\n", encoding="utf-8")
    save("excavator.meshes.json", meshes)  # Shared renderer's mesh interchange filename.
    save("excavator.kinematics.json", {"tracks": [{"joint": j} for j in joints]})
    notes = dict(physical_form=TITLES[n], enclosure_type="Parametric concept assembly",
                 mounting_guidance="Millimeters, Z up; inspection cutaways are explicitly named.",
                 manufacturability_rating="Not evaluated", component_placements=placements,
                 fabrication_details=["Every dimension is an authoring assumption, not a NASA measurement.",
                                      "Motion is design inspection only, not simulated plant operation."])
    document = dict(domain="mechanical", schema_version="1.0", artifact_id=f"ASSET-{n:02d}-mechanical",
                    revision=1, parts=definitions, components=components, mechanical=notes)
    validation = call_domain_tool("validate-domain", document)
    if not validation["is_valid"]:
        raise ValueError(validation)
    save("mechanical.ir.json", document)
    save("validation.json", validation)
    brief_path = asset / "brief.md"
    project = dict(hardware_ir_version="0.2", overview={"title": f"ASSET-{n:02d} - {TITLES[n]}",
                    "description": "Brief-driven mechanical concept. No process performance or physical qualification claimed.",
                    "category": "Industrial", "difficulty": "Advanced"},
                   components=[dict(ref_des=c["ref_des"], name=c["ref_des"], part_number=c["part_definition_id"],
                                    category="Mechanical", rationale="Separate concept geometry body") for c in components],
                   nets=[], mechanical=notes,
                   cad_model={"format": "step", "path": str(directory / "assembly.step"),
                              "sha256": hashlib.sha256((directory / "assembly.step").read_bytes()).hexdigest(),
                              "mesh_path": str(directory / "excavator.meshes.json"),
                              "kinematics_path": str(directory / "excavator.kinematics.json"), "units": "mm"},
                   assembly_metadata={"asset_id": f"ASSET-{n:02d}", "mechanical_ir": document,
                                      "sources": [brief_path.name], "status": "Concept engineering preview",
                                      "model_source": "assets/tools/build_machines.py",
                                      "assumptions": "All dimensions and inspection trajectories are authored assumptions. Cutaways are inspection representations. No fill levels, thermal states or flow are simulated."})
    save("mcp-request.json", project)
    result = rpc("http://127.0.0.1:8020/mcp", "tools/call", {"name": "forma.compile_project", "arguments": {
        "project_ir": project, "authoring_agent": "opencode", "visibility": "private",
        "prompt": brief_path.read_text(encoding="utf-8")}}, n)
    save("mcp-response.json", result)
    if result.get("isError"):
        raise ValueError(result)
    compiled = result.get("structuredContent") or json.loads(next(c["text"] for c in result["content"] if c["type"] == "text"))
    save("forma-compiled.json", compiled)
    if not compiled.get("persisted") or not compiled.get("is_valid"):
        raise ValueError("MCP did not confirm a valid persisted concept")
    render(directory, asset / "renders/preview.gif", frames=72, title=f"ASSET-{n:02d}  /  {TITLES[n]}", generic=True)
    save("provenance.json", {"asset_id": f"ASSET-{n:02d}", "project_id": compiled["project_id"],
        "forma_version": "0.4.0", "opencad_version": "0.2.4", "source_brief": brief_path.name,
        "model_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "body_count": len(meshes), "moving_body_count": len(joints), "native_cad_valid": compound.isValid(),
        "gif": {"frames": 72, "width": 960, "height": 720},
        "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir() if p.is_file()}})
    print(f"ASSET-{n:02d} complete: {len(meshes)} bodies, Forma {compiled['project_id']}", flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", type=int, nargs="+", default=list(range(2, 12)))
    args = parser.parse_args()
    for number in args.asset:
        build(number)
