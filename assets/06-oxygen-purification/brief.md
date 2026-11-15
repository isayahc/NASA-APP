# ASSET-06 — Oxygen purification and off-gas separation

**Priority:** Core MVP with **bounded simplified purification model**. **Flow:** mixed gas ASSET-05 → recovered O₂ to ASSET-07 storage; contaminants and lost O₂ to recorded rejects/vents.

## Research context

NASA's lunar MRE plant model represents **oxygen purification using an yttria-stabilized zirconia (YSZ) electrode/device**, then downstream oxygen liquefaction and storage. This is a **conceptual/model subsystem**; do not assume a flight-ready filter or claim its real efficiency is known. Purity matters because gas from a hot reactor may contain other volatiles and a mission-supply product needs explicit requirements.

## Forma / OpenCAD build brief

Create modular gas-conditioning skid: inlet manifold, dust/condensate guard where justified, insulated purification cell/enclosure, electrical terminals, temperature-control jacket, O₂ outlet, reject stream, valves and removable service cartridge. In cross-section, show **distinct feed, recovered, and reject gas paths**. Parametrize max mol/s inlet, design purity target, purity/recovery/energy and temperature bounds as separately documented inputs; do not pretend a consumer filter implements zirconia electrochemical purification.

## Executable machine contract

- **Commands:** `start_purifier`, `set_throughput(mol_per_s)`, `measure_product`, `hold`, `isolate`.
- **Inputs:** actual species-resolved gas moles/temperature/pressure, power, declared recovery fraction, selectivity/purity relation, operating range and available storage capacity.
- **Outputs:** species-resolved purified product, reject/waste stream, lost oxygen, kWh, purity and validation status.
- **States:** IDLE, HEATING, READY, PURIFYING, BLOCKED, FAULT.
- **Physics:** conservation **by gas species** across product + rejects + inventory change. Never purify more O₂ than received; purity improvement may reduce recovery and/or consume power. If insufficient information supports a detailed YSZ cell, label and implement a **bounded black-box recovery/selectivity model**, not imagined membrane chemistry.
- **Failure cases:** off-spec purity, excessive feed or pressure, insufficient power, full receiving tank, invalid sensor reading.

## MVP acceptance

Given an impure reactor gas batch, a nontrivial amount of product O₂ flows into ASSET-07; contaminant and lost oxygen balances close, and insufficient power or full downstream storage blocks transfer. Product is labeled **simulated purified gaseous O₂**, not automatically propellant-grade LOX.

## Technical sources

- [NASA NTRS — MRE plant system model](https://ntrs.nasa.gov/citations/20240013999) (YSZ purification → liquefaction/storage sequence).
- [NASA NTRS — VMOMS instrumentation](https://ntrs.nasa.gov/citations/20250002903) (monitoring oxygen and other evolved volatiles).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
