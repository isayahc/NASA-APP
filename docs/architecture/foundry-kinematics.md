# F3 — Committed task progress → actual CAD joints (#12)

The live launcher (`bash scripts/run_foundry_live.sh`) now drives the original
OpenIndustries CAD meshes for excavator, hopper and preheater. The static launcher
remains a layout preview. Advance work using the [existing controller CLI](foundry-stream.md);
the pose adapter never starts a clock or issues a controller command. F2 browser
controls (#11) remain an independent dependency for the complete operator UI.

## Source audit and identity

| Machine / authoritative task / single phase | Verified source joints | Frames and limits |
| --- | --- | --- |
| `foundry-machine-01` / `regolith-delivery` / `dig-haul-dump` | Four `joint_wheel_{l,r}_{front,rear}`, `joint_arm_{l,r}`, `joint_drum_{l,r}`; 24 fixed child joints | Arms 0–75°; wheels/drums 0–360°. Right arm/drum have negative X axes. Six source frames: base, dig_tool_l/r, payload_l/r, dump_frame. |
| `foundry-machine-02` / `hopper-to-preheater` / `meter-regolith` | `move_gate`, `spin_auger_shaft`, `spin_auger_flight` | Gate 0–60°, screw 0–360°. No attachment-frame artifact supplied. |
| `foundry-machine-03` / `preheat-regolith` / `heat-to-release` | `spin_auger_shaft`, `spin_auger_flight` | Screw 0–360°. No attachment-frame artifact supplied. |

ASSET-01 has 33 bodies; hopper 18; preheater 20. The original STEP compounds
import with generic Open CASCADE translator names, **not the original body names**.
`foundry-kinematics-map.mjs` verifies the STEP, original mesh and joint files against
their preserved provenance SHA-256 values. It then matches each named rest mesh to
exactly one STEP-derived solid using all six normalized bounding coordinates with
a 1mm tessellation tolerance. Missing or ambiguous matches, reused parts, missing
required joints and unsupported joint types fail explicitly. Array position and
generic STEP labels are never treated as semantic identity. This mapping is specific
to the checked-in concepts; different CAD must pass the mapping audit again.

The browser verifies SHA-256 of all imported vertex/index arrays and part IDs before
driving anything. The stable binding is machine ID + task ID + named source body +
source-digest-bound OI part ID. Joint/mesh hashes and limits accompany the map at
`GET /api/foundry/kinematics` (local, read-only). No GIF or substitute geometry is used.

## Pose contract and explicitly assumed trajectories

- Snapshot jobs now include `step_duration_ms` and `planned_steps`, projected from
  the stored scenario. Only **successful `completed_steps`** drive motion; total
  simulation time, wall time, thermal readings and waiting ticks do not.
- Successful work seconds = `completed_steps * step_duration_ms / 1000`.
  Spins use an **assumed visual rate** π/4 rad/work-second (7.5 RPM), modulo 2π
  within the source revolute limits. This rate is not a motor measurement.
- Arm and gate angle = source upper limit × sin(π × completed/planned steps).
  This bounded lift/open/close envelope is a declared presentation policy for
  the existing single task phase, not additional claimed dig/haul subphases.
- Wheels turn **in place** while delivery progresses. There is no validated
  trajectory, terrain contact, slip, steering joint, chassis translation or
  wheel-distance odometry in these inputs; none is inferred. No digging physics,
  material particle movement or oxygen production is implemented here.
- Source `(x,y,z)` Z-up millimeters maps to `(x,z,-y)/1000`, then subtracts
  OI `originOffset`. Axes use the same right-handed rotation without scaling.
- Each joint matrix is `T(pivot) R(axis,angle) T(-pivot)`. Child matrices compose
  with their parent's matrix. Thus drums inherit arm lift and fixed scoops inherit
  both lift and drum spin. Unjointed roots stay fixed.
- OI expects per-part XYZ Euler **degrees**, translation **meters**, about its
  mesh bounding-box center. The adapter compensates the translation using
  `M(center) - center`, using the exact Float32 pivot precision of native OI.

## Native rendering boundary and failure behavior

The pinned OI `838ea330296148621f7a23f7cb647b11e73b5184` exposes
`evaluateWorkspace` → `applyWorldPoses` inside `WorkspaceViewer`, but does not
export a runtime subscription hook. A narrow, checked Vite source transform wraps
that call with the NASA adapter and adds/removes a view-only wake event. Changed
upstream seam text fails explicitly. No vendor files are edited; OI retains mesh
construction, rendering, picking, scene state and persistence. Both Detailed and
on-demand Lite use the same pose path. This integration is for the live dev launcher;
it is not a production deployment adapter.

No animation track, keyframe, scene revision, task, inventory or energy is written
by the adapter. Poses change only on accepted committed progress, without interpolation
or extrapolation. Paused/waiting/failed/cancelled jobs retain their last successful
progress. Missing stream events freeze the last valid pose. Offline/online handlers
close/reopen EventSource; reconnect and reload reconstruct from the committed head.
Duplicate/stale/wrong-instance frames and regressed task progress cannot rewind it.
Switching to a new runtime requires a new configured session (F2 reset is not implemented).

The visible label says **SIMULATED / DERIVED** and disclaims terrain/travel physics
and mechanical validation. The read-only `window.__NASA_FOUNDRY_POSES` getter exposes
copies of the **actual native mesh matrices** for evidence, not pose commands.

## Verification

After the real scene build and dependency install:

```bash
(cd vendor/openindustries && node --import tsx --test ../../tests/foundry_kinematics.test.ts)
(cd vendor/openindustries && node --import tsx ../../scripts/verify_foundry_kinematics_browser.ts)
```

The browser test uses isolated API/UI ports 8789/5175 and a fresh SQLite run. It
compares all 71 native part matrices to committed task-derived transforms, checks
selective wheel/arm/drum/gate/screw movement, pause, blocked feeder, power cut,
cancel, disconnect/reconnect, stale frames and refresh, and verifies the persistent
scene head remains unchanged. Existing runtime/SSE tests also run in CI.

Screenshots, video and JSON evidence are under `.generated/issue-12/`, uploaded by
the existing foundry-stream CI artifact workflow. They contain simulated state,
not controller credentials. Local databases remain ignored and are not uploaded.
