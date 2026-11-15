# ASSET-05 — Reactor gas capture manifold and oxygen/volatile monitoring

**Priority:** Core MVP. **Flow:** crude gas from ASSET-04 → measured gas stream → ASSET-06 purification.

## Research context

NASA Kennedy built a **Volatile and Oxygen Measurement System (VMOMS)** for molten regolith electrolysis testing. It monitored gases released during evacuation, heating and electrolysis and used zirconia oxygen sensors, a residual gas analyzer and gas chromatography. The system also monitored reactor gas pressure. This is direct evidence that **gas quantity/purity measurement and safety monitoring** must be separately represented; do not infer perfect O₂ purity from reactor current alone.

## Forma / OpenCAD build brief

Model reactor hood outlet, gas manifold tubes, isolating valves, instrument box/rack with sensor ports, pressure transducer, flow element, sampling bypass, residual-gas analyzer housing and purge/vent port. Make valve handles and moving shutters independent components. This is a **conceptual simplified space-compatible layout**, not a duplicate of the NASA lab instrument; do not copy its setpoints/design pressure into the lunar plant without an engineering basis.

## Executable machine contract

- **Commands:** `open_capture_path`, `sample_gas(duration_s)`, `measure_stream`, `isolate`, `relieve_to_loss_stream` (controller-gated).
- **Inputs:** reactor gas moles/composition/temperature/pressure, upstream gas-production rate, valve states, sensor measurement assumptions and available electrical power.
- **Outputs:** actual stream transferred by species (mol, kg), simulated noisy measurements with separate truth/reading, sample timestamp, measured O₂ fraction, pressure, flow, explicit vent/loss inventory.
- **States:** ISOLATED, READY, CAPTURING, MEASURING, VENTING, BLOCKED, SENSOR_FAULT.
- **Model requirements:** prevent a manifold from pulling gas faster than generated/available; preserve gas species through transfers and leak/vent loss. Keep **true process state** separate from **synthetic instrument reading**. Alarm on invalid/overpressure scenario limits, not unverified universal numeric safety thresholds.
- **Failure cases:** sensor unavailable/drift, line blocked, valve closed, gas pressure out of simulated operating band, downstream refusal.

## MVP acceptance

When electrolysis produces gas, ASSET-05 transfers and reports a bounded amount; changing reactor output changes meter readings, and downstream ASSET-06 cannot receive more gas than arrives. Instrument fault must yield an **unknown/invalid reading**, not fabricated certainty.

## Technical sources

- [NASA NTRS — Development of VMOMS](https://ntrs.nasa.gov/citations/20250002903) (monitoring hardware and quantities).
- [NASA NTRS — LR-1 MRE test](https://ntrs.nasa.gov/citations/20260006167) (VMOMS used during the measured large-scale test).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
