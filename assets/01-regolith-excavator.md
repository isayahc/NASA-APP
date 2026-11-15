# ASSET-01 — Regolith excavation and delivery rover

**Priority:** Core MVP; simplify to an executable finite regolith source only if rover locomotion is blocked. **Flow:** lunar terrain → `regolith-lot` → ASSET-02 receiving hopper.

## Research context

NASA's RASSOR and successor IPEx use counter-rotating bucket drums so reaction forces partially cancel in low lunar gravity; the robot can dig, carry and unload regolith into a receiving container. The NASA MRE plant study specifically includes RASSOR excavation ahead of hopper/screw conveyor. This is a strong **geometric and task-sequence reference**, not an assertion of flight-qualified mining performance.

## Forma / OpenCAD build brief

Model a compact four-wheel or tracked chassis on a low lunar gravity site; **two opposed bucket drums** with visible scoop pockets, pivoting lift arms, wheel or track drives, and a front-facing unloading envelope. Make chassis, drums, drum scoops, arm pivots, wheels and hopper-facing dump port separately selectable. Include local frames `base`, `dig_tool_l`, `dig_tool_r`, `payload_l`, `payload_r`, `dump_frame`; preserve mechanical joint axes. Parametrize drum radius/width, scoops per drum, bucket capacity, arm travel, wheelbase, clearance and payload; do not substitute arbitrary dimensions as factual NASA design dimensions.

**Visual demo action:** drums counter-rotate against a bounded regolith patch; measured lot mass enters drums; arms raise, rover traverses a path, drums reverse over hopper to release the same material lot. Optional dust visualization may **not** be counted as physical mass.

## Executable machine contract

- **Commands:** `plan_excavation(zone, target_kg)`, `dig(duration_s)`, `raise_load`, `navigate(waypoints)`, `dump(hopper_id)`, `return_to_site`.
- **Machine states:** IDLE → DIGGING → LOADED → HAULING → DOCKED → UNLOADING → IDLE; BLOCKED/FAULT where relevant.
- **Inputs:** source terrain lot ID/composition/remaining kg, power in W, route and velocity limits, available drum capacity kg, target hopper capacity kg.
- **Outputs:** transferred lot ID, transferred kg, remaining terrain kg, kWh used, travel/work time, motion/pose and failure event.
- **Invariants:** `removed_from_terrain_kg = carried_kg + dumped_kg + logged_losses_kg`; cannot scoop more than finite source inventory, exceed drum payload, or teleport lot directly into the hopper; dumping requires valid pose and capacity.
- **Failure paths:** obstructed route, wheel stall, underfilled or full bucket, depleted patch, hopper full, power shortage.

## MVP acceptance

A dispatched dig/haul/unload sequence moves a named finite lot into ASSET-02; its mass, timestamps and visible wheel/drum/arm poses change consistently. A failed delivery does **not** credit the hopper. Geometry may start simplified; the state/inventory behavior may not.

## Technical sources

- [NASA — RASSOR technology](https://technology.nasa.gov/patent/KSC-TOPS-7) (counterrotating bucket-drum excavation and dump behavior).
- [NASA — Infrastructure Pilot Excavator](https://www.nasa.gov/infrastructure-pilot-excavator/) (IPEx mechanism and subsystem design context).
- [NASA — Public RASSOR 3D reference](https://science.nasa.gov/3d-resources/regolith-advanced-surface-systems-operations-robot-rassor/) (optional reference geometry; check source-license/attribution terms before reuse).
- [NASA NTRS — MRE plant system modeling](https://ntrs.nasa.gov/citations/20240013999) (upstream excavation in actual plant concept).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
