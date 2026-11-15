"""Check the portable asset layout, GIFs and optionally saved Forma projects."""

import argparse
import json
from pathlib import Path
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main(online: bool = False) -> None:
    """Validate each machine's local deliverables and write a current-path index."""
    evidence = []
    for number in range(1, 12):
        asset = next(ROOT.glob(f"{number:02d}-*"))
        for name in ("README.md", "brief.md", "renders/preview.gif", "renders/preview.png",
                     "artifacts/mechanical.ir.json", "artifacts/validation.json",
                     "artifacts/forma-compiled.json", "artifacts/provenance.json"):
            assert (asset / name).is_file(), asset / name
        step = asset / "artifacts" / ("excavator.step" if number == 1 else "assembly.step")
        assert step.read_bytes().startswith(b"ISO-10303-21;"), step
        with Image.open(asset / "renders/preview.gif") as gif:
            assert gif.size == (960, 720) and gif.n_frames >= 72
            first = gif.convert("RGB").tobytes()
            gif.seek(gif.n_frames // 3)
            assert first != gif.convert("RGB").tobytes()
            item = {"asset": number, "directory": asset.relative_to(ROOT).as_posix(),
                    "gif": (asset / "renders/preview.gif").relative_to(ROOT).as_posix(), "frames": gif.n_frames}
        compiled = json.loads((asset / "artifacts/forma-compiled.json").read_text())
        assert compiled["persisted"] and compiled["is_valid"]
        count = len(compiled["project_ir"]["components"])
        if online:
            with urllib.request.urlopen(f"http://127.0.0.1:8020/projects/{compiled['project_id']}", timeout=20) as response:
                saved = json.load(response)
            assert len(saved["project_ir"]["components"]) == count
        item.update(project_id=compiled["project_id"], recorded_components=count, online_readback=online)
        evidence.append(item)
    (ROOT / "gallery/verification.json").write_text(json.dumps(evidence, indent=2)+"\n")
    print(f"Verified all 11 asset folders, STEP files, GIFs and recorded MCP results (online={online}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true")
    main(parser.parse_args().online)
