# ASSET-03 — Electrically heated regolith preheating auger

**Priority:** Core MVP. **Flow:** ASSET-02 feed → warm preconditioned regolith → ASSET-04 MRE reactor.

## Research context

NASA's MRE plant system model explicitly includes a **preheating auger** that begins heating excavated regolith before it enters the electrolysis reactor, reducing the heat needed in the reactor. This is **not** an icy-regolith dryer/water extractor; those belong to a different ISRU process. The thermal plant must account for the power and time required to raise bulk feed temperature.

## Forma / OpenCAD build brief

Create a long insulated tubular auger with a visible longitudinal cutaway option, rotating helical screw, inlet/outlet gate, external resistance-heating zones, temperature sensors, insulated shroud, motor and mounting frame. Geometry parts: `shell`, `insulation`, `auger_shaft`, `heater_zones`, `drive`, `sensor_ports`, `feed_inlet`, `hot_discharge`. Parametrize length, screw diameter/pitch, fill factor, maximum zone temperature, insulation thickness, heater rating and permitted RPM. Use a thermal gradient UI overlay only when computed from model state.

## Executable machine contract

- **Commands:** `start_preheat(setpoint_K)`, `advance_feed(kg_per_s)`, `hold`, `release_to_reactor(lot_id)`, `shutdown`.
- **Inputs:** actual lot mass/composition, inlet temperature K, heat capacity model J/(kg·K), supplied heater power W, available reactor capacity, thermal-loss parameters.
- **Outputs:** outlet lot mass/composition/temperature K, elapsed processing time s, consumed energy J or kWh, losses W and safety events.
- **States:** COLD, HEATING, AT_TEMPERATURE, CONVEYING, HOLDING, SHUTTING_DOWN, FAULT.
- **Physics:** integrate `m*c_p*dT/dt = P_heater - Q_loss - sensible enthalpy carried by throughput` with declared assumptions/phase-appropriate modifications; never let stock preheat instantly to setpoint. Transfer only a real lot at its computed temperature.
- **Failure cases:** insufficient electrical power, heat leakage, blocked discharge, sensor failure, heating-zone over-limit.

## MVP acceptance

Machine takes **time and power** to heat a named input lot, sends the lot to ASSET-04 only when ready and the reactor can receive it, and reduces throughput or stops when power is restricted. Actual auger motion and temperature inspection agree with controller state.

## Technical sources

- [NASA NTRS — System Modeling of a Lunar MRE Plant](https://ntrs.nasa.gov/citations/20240013999) (preheating auger purpose and process order).
- [NASA NTRS — MRE 2024 conference abstract](https://ntrs.nasa.gov/citations/20240012420) (thermal equilibrium / plant subsystem assumptions).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
