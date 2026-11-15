# NASA RASSOR — imported visual geometry

The original [NASA RASSOR 3D resource](https://science.nasa.gov/3d-resources/regolith-advanced-surface-systems-operations-robot-rassor/) is distributed as **GLB**, **not STL**. NASA's GitHub mirror is [nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Regolith%20Advanced%20Surface%20Systems%20Operations%20Robot%20%28RASSOR%29).

- **NASA source credit:** NASA/Dewey L. Smith; NASA/Jason M. Schuler
- **Conversion:** \`scripts/import_rassor.py\` uses Blender's glTF importer to decode the original GLB, bakes scene transforms, optionally simplifies to a **maximum 250,000 triangle target**, then exports binary STL.
- **Derived output:** \`assets/rassor/rassor-nasa-reference.stl\`
- **Integrity:** \`assets/rassor/rassor-nasa-reference.metadata.json\` records the original and derivative SHA-256 hashes, triangle counts and source attribution.
- **NASA's official guidelines:** https://www.nasa.gov/nasa-brand-center/images-and-media/ — acknowledge NASA, avoid implied endorsement, and review any third-party restrictions.
- **Reproduce:** \`python -m pip install "trimesh>=4.0,<5" "fast-simplification>=0.1.11,<1" "numpy>=1.24,<3"\` and then \`python scripts/import_rassor.py\`.
- **Automation:** \`.github/workflows/import-rassor.yml\` builds the STL and commits the generated output; \`workflow_dispatch\` can rerun it.

**Important:** STL is a **single static untextured mesh**: it does not preserve articulated joints, moving bucket drums, wheel hierarchy, textures, CAD design history, or physical mass/collision validation. It is an *asset/reference* for OpenCAD/OpenIndustries, **not a complete simulated excavator**. For live operations, create an articulated machine with named parts/joints and task-driven motion, and validate scale/axis alignment against the original GLB. Do not present this as a NASA-endorsed or flight-qualified machine.

For intended machine commands, inventory flow and validation, see [the excavation subsystem brief](../01-regolith-excavator/brief.md).
