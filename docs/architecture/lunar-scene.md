# Lunar foundry scene — native OpenIndustries spatial integration

**Implements #4. Status: imported CAD and validated spatial wiring; NOT an operating factory.** The actual machine/process execution is #5 and live task-driven motion is #6.

## One-command local demo

From a checkout of NASA-APP on WSL2/Linux (or macOS) with Git, Node.js >=22.16 and npm:

```bash
bash scripts/run_foundry.sh
```

The command clones a separate pinned OpenIndustries checkout if needed, installs its dependencies, builds the real STEP-derived scene, creates a local SQLite scene store with immutable verified CAD assets, then starts the **existing OI Vite/API workbench**. Open the printed `http://127.0.0.1:5173/?localSceneId=...` URL. No OpenCode provider key or hosted database is needed.

To build and validate the scene without starting a server:

```bash
bash scripts/run_foundry.sh --build-only
```

The script refuses to mutate a mismatched existing OpenIndustries checkout. Set `OI_ROOT` to a dedicated checkout at SHA `838ea330296148621f7a23f7cb647b11e73b5184`. Set `NASA_OI_SCENE_STORE` to a different local store path if desired.

## Produced artifacts

| Output | Meaning |
| --- | --- |
| `.generated/lunar-foundry.oi.json` | Self-contained native `astra.scene` portable scene with ten real STEP-derived assets, static placements and an OI System Inspector |
| `.generated/lunar-foundry.connections.json` | Versioned, declared machine ports, connection endpoints, resource categories, provenance and capabilities (not executable wiring) |
| `.generated/lunar-foundry.session.json` | Native local OI scene identity, store path, and direct browser URL |
| `.generated/oi-scene-store/` | OI SQLite scene history and immutable per-asset geometry |
| `.generated/lunar-foundry-browser.png` | CI browser evidence that the actual imported OI scene rendered and could be inspected |

Generated files and vendor checkouts are ignored by Git. CI uploads the export, graph, local-scene receipt, and screenshot as an artifact. The canonical, reviewable **source** is `scenes/lunar-foundry.plan.json` plus the existing 11-machine `assets/` tree.

## Engineering integration decisions

**Sources:** PR #3's actual STEP assemblies (`assets/01-...` through `assets/10-...`) and source MechanicalIR JSON. Asset 11 (LOX depot) is **Phase 2** and excluded from the primary layout.

**Native APIs reused:**

- `occt-import-js@0.0.23` + OI `src/lib/step.ts::stepToAsset`: reads the real STEP solids and produces verified surface triangle/part hierarchy.
- `src/lib/workspace.ts::makeManifest/readManifest/hydrateManifest`: versioned `astra.scene` serialization, complete bundling and round-trip import.
- `src/lib/system-inspection.ts::readSystemInspection/meshFingerprint`: native semantic CAD inspector, bound to actual STEP digests and MechanicalIR source SHA-256.
- `server/local-scene-backend.ts::LocalSceneBackend`: existing local asset deduplication, SQLite persistence and scene revision/history logic.

**Axes/units:** The authored models are right-handed Z-up millimeters. Native OI STEP conversion maps `(x, y, z) -> (x, z, -y) / 1000`, then centers footprint X/Z and grounds Y=0; machine placements are in right-handed **Y-up meters**. Source SHA-256, normalized dimensions, metadata, and stable instance IDs are retained.

**Layout:** Main process lane 01 excavation -> 02 hopper -> 03 preheater -> 04 reactor -> 05 gas capture -> 06 purification -> 07 oxygen buffer; secondary service lane 08 power, 10 solids receiver, 09 thermal support. The entire geometry is contained within a calculated OI room; bounding-box overlaps are rejected. Typed port endpoints and connection lengths are recorded for future runtime integration.

**Status semantics:** In the actual OI System Inspector, each machine is bound to its CAD source and MechanicalIR artifact. `resolved` indicates the **source geometry mapping is valid**, not that the plant is ready to operate. Each record explicitly says **connections declared / NOT EXECUTABLE**. Port reach and wiring are engineering intent only; detailed plumbing, collision-free arm sweeps, structural capacity and space qualification are not verified.

**No fake animation:** Scene motion tracks are empty. No simulated oxygen flow or output graph is authored in this issue. Do **not** wire the existing OI two-second scene-revision sync into process animations; #6 needs a real runtime stream.

## Verification

```bash
node --test tests/lunar_scene.test.mjs
bash scripts/run_foundry.sh --build-only
```

CI checks real STEP tessellation for ten machines, source hashes, normalized nonzero geometry, station clearance, feed port adjacency, valid native OI System Inspector bindings, local scene save/reload, and independent Playwright Chromium import/selection/export/reimport (without missing or placeholder assets). The browser run validates actual render/inspection; it does not certify process physics.

**Known scope limits:** Imported geometry is static; operation state will come from the OI simulation core in #5, with live pose streaming in #6. External logistics, NASA-grade thermal/chemical process predictions, and LOX storage are not part of this issue.
