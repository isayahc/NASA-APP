"""Submit the built excavator to Forma's HTTP MCP compile tool and retain evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import urllib.request


def rpc(url: str, method: str, params: dict, request_id: int) -> dict:
    """Send a JSON-RPC request to Forma's stateless Streamable HTTP endpoint."""
    request = urllib.request.Request(url, data=json.dumps({
        "jsonrpc": "2.0", "id": request_id, "method": method, "params": params
    }).encode(), headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(request, timeout=300) as response:
        result = json.load(response)
    if "error" in result:
        raise RuntimeError(result["error"])
    return result["result"]


def compile_asset(directory: Path, url: str) -> None:
    """Compile real CAD plus engineering metadata via MCP; never infer persistence."""
    if (directory / "mcp-response.json").exists():
        raise ValueError("This build already has an MCP response; inspect it before creating another project")
    document = json.loads((directory / "mechanical.ir.json").read_text())
    provenance = json.loads((directory / "provenance.json").read_text())
    frames = json.loads((directory / "frames.json").read_text())
    components = [{"ref_des": c["ref_des"], "part_number": c["part_definition_id"],
                   "name": c["ref_des"].replace("_", " "), "category": "Mechanical",
                   "rationale": "Named separate excavator body; parameterized concept geometry, not flight-qualified hardware."}
                  for c in document["components"]]
    project = {
        "hardware_ir_version": "0.2",
        "overview": {"title": "ASSET-01 — Regolith excavation and delivery rover",
                     "description": "RASSOR-inspired four-wheel lunar regolith excavator with two opposed bucket drums and articulated lift arms. Concept engineering asset for NASA-APP.",
                     "category": "Robotics", "difficulty": "Advanced"},
        "components": components, "nets": [], "mechanical": document["mechanical"],
        "cad_model": {**document["cad_model"], "format": "step", "units": "mm", "coordinate_system": "z-up",
                      "path": str((directory / "excavator.step").resolve()),
                      "sha256": next(value for key, value in provenance["sha256"].items() if key.endswith("excavator.step")),
                      "mesh_path": str((directory / "excavator.meshes.json").resolve()),
                      "kinematics_path": str((directory / "excavator.kinematics.json").resolve())},
        "constraints": ["All dimensions and capacities are uncalibrated assumptions, not NASA specifications.",
                        "Material lot transfer and electrical power must be controller-accounted; no runtime is implemented by this design."],
        "assembly_metadata": {"asset_id": "ASSET-01", "native_mechanical_ir": document,
                              "attachment_frames": frames, "provenance": provenance,
                              "runtime_status": "engineering asset only; task/controller integration pending",
                              "machine_commands": ["plan_excavation", "dig", "raise_load", "navigate", "dump", "return_to_site"]}
    }
    (directory / "mcp-request.json").write_text(json.dumps(project, indent=2)+"\n")
    handshake = rpc(url, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                    "clientInfo": {"name": "NASA-APP-excavator", "version": "1"}}, 1)
    (directory / "mcp-initialize.json").write_text(json.dumps(handshake, indent=2)+"\n")
    response = rpc(url, "tools/call", {"name": "forma.compile_project", "arguments": {
        "project_ir": project, "authoring_agent": "opencode", "visibility": "private",
        "prompt": (Path(__file__).resolve().parents[1] / "01-regolith-excavator/brief.md").read_text(encoding="utf-8")
    }}, 2)
    (directory / "mcp-response.json").write_text(json.dumps(response, indent=2)+"\n")
    if response.get("isError"):
        raise RuntimeError(response)
    compiled = response.get("structuredContent")
    if not compiled:
        compiled = json.loads(next(c["text"] for c in response["content"] if c["type"] == "text"))
    (directory / "forma-compiled.json").write_text(json.dumps(compiled, indent=2)+"\n")
    if not compiled.get("persisted") or not compiled.get("project_id"):
        raise RuntimeError("MCP did not confirm a persisted project")
    print(json.dumps({k: compiled.get(k) for k in ("project_id", "persisted", "is_valid", "validation")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8020/mcp")
    args = parser.parse_args()
    compile_asset(args.directory.resolve(), args.url)
