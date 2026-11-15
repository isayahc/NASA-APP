"""Render an offline CAD inspection GIF from the exported meshes and joints."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import vtk
from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray, vtk_to_numpy

from opencad.kernel.core.models import KinematicJoint
from opencad.kinematics import evaluate_assembly_pose


def color(ref: str) -> tuple[float, float, float]:
    """Choose readable inspection colors by mechanical role."""
    if ref.startswith("scoop"):
        return (0.94, 0.57, 0.18)
    if ref.startswith("drum"):
        return (0.67, 0.74, 0.80)
    if ref.startswith("arm"):
        return (0.20, 0.57, 0.70)
    if ref.startswith("wheel"):
        return (0.28, 0.34, 0.41)
    if ref.startswith(("drive", "pivot")):
        return (0.46, 0.55, 0.62)
    return (0.78, 0.83, 0.86)


def render(directory: Path, output: Path, frames: int = 90, *, title: str = "ASSET-01  /  REGOLITH EXCAVATOR", generic: bool = False) -> None:
    """Render actual mesh geometry with OpenCAD-evaluated design articulation."""
    meshes = json.loads((directory / "excavator.meshes.json").read_text())
    tracks = json.loads((directory / "excavator.kinematics.json").read_text())["tracks"]
    joints = [KinematicJoint.model_validate(track["joint"]) for track in tracks]
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(0.035, 0.055, 0.085)
    renderer.SetBackground2(0.14, 0.20, 0.27)
    renderer.GradientBackgroundOn()
    actors = {}
    for body in meshes:
        vertices = np.array(body["mesh"]["vertices"], dtype=np.float64).reshape(-1, 3)
        triangles = np.array(body["mesh"]["faces"], dtype=np.int64).reshape(-1, 3)
        points = vtk.vtkPoints()
        points.SetData(numpy_to_vtk(vertices, deep=True))
        cells = vtk.vtkCellArray()
        packed = np.column_stack((np.full(len(triangles), 3), triangles)).ravel()
        cells.SetCells(len(triangles), numpy_to_vtkIdTypeArray(packed, deep=True))
        poly = vtk.vtkPolyData()
        poly.SetPoints(points)
        poly.SetPolys(cells)
        normals = vtk.vtkPolyDataNormals()
        normals.SetInputData(poly)
        normals.SetFeatureAngle(40)
        normals.SplittingOn()
        mapper = vtk.vtkPolyDataMapper()
        mapper.SetInputConnection(normals.GetOutputPort())
        actor = vtk.vtkActor()
        actor.SetMapper(mapper)
        actor.GetProperty().SetColor(*body.get("color", color(body["ref_des"])))
        actor.GetProperty().SetSpecular(0.35)
        actor.GetProperty().SetSpecularPower(35)
        renderer.AddActor(actor)
        actors[body["shape_id"]] = actor

    plane = vtk.vtkPlaneSource()
    plane.SetOrigin(-4000, -4000, -8)
    plane.SetPoint1(4000, -4000, -8)
    plane.SetPoint2(-4000, 4000, -8)
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(plane.GetOutputPort())
    floor = vtk.vtkActor()
    floor.SetMapper(mapper)
    floor.GetProperty().SetColor(0.075, 0.10, 0.13)
    renderer.AddActor(floor)
    for position, intensity in (((-3000, 2000, 5000), 0.8), ((2500, -2000, 3000), 0.6)):
        light = vtk.vtkLight()
        light.SetPosition(*position)
        light.SetFocalPoint(0, 0, 500)
        light.SetIntensity(intensity)
        renderer.AddLight(light)
    renderer.AutomaticLightCreationOff()
    camera = renderer.GetActiveCamera()
    camera.ParallelProjectionOn()
    all_vertices = np.concatenate([np.array(b["mesh"]["vertices"]).reshape(-1, 3) for b in meshes])
    center = (all_vertices.min(axis=0)+all_vertices.max(axis=0))/2
    radius = max(np.linalg.norm(all_vertices-center, axis=1))
    camera.SetParallelScale(max(radius*1.35, 800) if generic else 1750)
    camera.SetViewUp(0, 0, 1)
    window = vtk.vtkRenderWindow()
    window.SetOffScreenRendering(1)
    window.SetSize(960, 720)
    window.SetMultiSamples(4)
    window.AddRenderer(renderer)
    capture = vtk.vtkWindowToImageFilter()
    capture.SetInput(window)
    capture.SetInputBufferTypeToRGB()
    capture.ReadFrontBufferOff()
    font_path = Path("C:/Windows/Fonts/segoeui.ttf")
    font = ImageFont.truetype(str(font_path), 25) if font_path.exists() else ImageFont.load_default()
    small = ImageFont.truetype(str(font_path), 16) if font_path.exists() else font
    images = []
    for index in range(frames):
        t = index / frames
        lift = 0.65 * math.sin(math.pi*t)**2
        progress = {"joint_arm_l": lift, "joint_arm_r": lift, "joint_drum_l": t, "joint_drum_r": t}
        if generic:
            progress = {j.id: (t if "spin" in j.id else math.sin(math.pi*t)**2) for j in joints}
        poses = evaluate_assembly_pose(joints, progress)
        for shape_id, pose in poses.items():
            x, y, z, w = pose.rotation_quaternion_xyzw
            matrix = vtk.vtkMatrix4x4()
            rotation = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
            for row in range(3):
                for col in range(3):
                    matrix.SetElement(row, col, rotation[row][col])
                matrix.SetElement(row, 3, pose.translation_mm[row])
            actors[shape_id].SetUserMatrix(matrix)
        angle = math.radians(35) + 2*math.pi*t
        focal = center if generic else (0, 0, 520)
        distance = max(radius*3, 3000) if generic else 4500
        camera.SetPosition(focal[0]+distance*math.cos(angle), focal[1]+distance*math.sin(angle), focal[2]+distance*0.62)
        camera.SetFocalPoint(*focal)
        renderer.ResetCameraClippingRange()
        window.Render()
        capture.Modified()
        capture.Update()
        pixels = vtk_to_numpy(capture.GetOutput().GetPointData().GetScalars()).reshape(720, 960, 3)
        image = Image.fromarray(np.flipud(pixels).copy())
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, 960, 90), fill=(12, 20, 31))
        draw.text((28, 15), title, font=font, fill=(238, 243, 249))
        draw.text((29, 52), f"FORMA 0.4.0  |  Native CAD  |  {len(meshes)} bodies  |  Engineering concept", font=small, fill=(145, 184, 208))
        draw.rectangle((0, 675, 960, 720), fill=(12, 20, 31))
        draw.text((28, 688), "DESIGN PREVIEW  -  Assumed dimensions; no process simulation", font=small, fill=(228, 193, 137))
        images.append(image)
    output.parent.mkdir(parents=True, exist_ok=True)
    # One common palette prevents distracting per-frame color changes.
    palette = images[0].quantize(colors=240)
    indexed = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
    indexed[0].save(output, save_all=True, append_images=indexed[1:], duration=70, loop=0, disposal=2)
    images[0].save(output.with_suffix(".png"))
    window.Finalize()
    with Image.open(output) as result:
        assert result.n_frames == frames and result.size == (960, 720)
    print(f"Rendered {output}: {frames} frames, 960x720, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    asset = Path(__file__).resolve().parents[1] / "01-regolith-excavator"
    parser.add_argument("--build", type=Path, default=asset / "artifacts")
    parser.add_argument("--output", type=Path, default=asset / "renders/preview.gif")
    args = parser.parse_args()
    render(args.build.resolve(), args.output.resolve())
