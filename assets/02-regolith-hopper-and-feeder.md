# ASSET-02 — Regolith receiving hopper, metering gate and screw feeder

**Priority:** Core MVP. **Flow:** ASSET-01 excavator → finite hopper → metered feed into ASSET-03 preheater.

## Research context

NASA's 2024 MRE plant system model/poster uses a **receiving hopper** plus **screw conveyor (SCD)** between a RASSOR-type rover and preheating/processing. The 2012 NASA ISRU systems tool likewise separates excavation, regolith handling/feed and process reactor. Feed control matters because continuous plant throughput is limited by batch handoffs, material flow and power.

## Forma / OpenCAD build brief

Build a raised rectangular or conical hopper on structural legs, dust-sealed receiving mouth, hinged metering gate, feed chute, screw shaft in a tubular or U-shaped trough, drive motor and discharge flange toward the auger. Keep separate geometry objects for `hopper_shell`, `gate`, `auger_shaft`, `drive`, `inlet`, `outlet` and `support` so the gate/shaft can visibly operate. Parametrize hopper volume and bulk-density assumption, outlet width, auger pitch, allowable RPM and inclination; no guessed dimensions need be called NASA-derived.

**Visual demo action:** rover dumps a named lot, hopper level rises, gate opens, screw rotates **only while commanded**, and a measured portion moves into the preheater.

## Executable machine contract

- **Commands:** `accept_lot(source, lot_id)`, `open_gate(percent)`, `meter(target_kg_per_s, duration_s)`, `close_gate`, `clear_jam`.
- **Inputs:** regolith lot composition and mass kg, bulk density kg/m³, machine electrical power W, available downstream capacity kg, gate opening and shaft RPM.
- **Outputs:** consumed hopper kg, delivered feed lot ID/kg, remaining hopper kg, transferred particle composition and kg lost to explicitly modeled spill/dust.
- **States:** EMPTY, RECEIVING, READY, FEEDING, BLOCKED, JAMMED, FAULT.
- **Core model:** bounded mass-flow law from gate/RPM/available feed; calibrate coefficients as scenario assumptions and report them. Hard cap by actual mass and downstream capacity; conserve per-species mass on split/transfer.
- **Failure cases:** hopper empty/full, sealed inlet, conveyor jam, power interruption, preheater backpressure/capacity full.

## MVP acceptance

A transferred `regolith-lot` enters this hopper, feeds ASSET-03 over simulation ticks, and the same mass/composition leaves the hopper. Gate and auger movement match task states. No feed can flow while gates are closed, disabled or jammed.

## Technical sources

- [NASA NTRS — MRE plant model, block diagram](https://ntrs.nasa.gov/citations/20240013999).
- [NASA NTRS — MRE systems poster](https://ntrs.nasa.gov/api/citations/20240013999/downloads/LISC%20Fall%202024%20MRE%20Poster_v3.pdf?attachment=true) (RASSOR, supply hopper, auger/screw conveyor; figures are concept models, not detailed fabrication drawings).
- [NASA NTRS — ISRU System Model Tool](https://ntrs.nasa.gov/api/citations/20120001380/downloads/20120001380.pdf) (separate regolith feed/handling module).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
