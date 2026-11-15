# ASSET-07 — Oxygen buffer, optional compressor and finite gas storage

**Priority:** Core MVP for **finite gaseous oxygen inventory**; physically detailed compression is conditional on pressure architecture. **Flow:** ASSET-06 product O₂ → conditioned gas/buffer → finite storage → optional supply reservation.

## Research context

NASA's MRE systems model sends purified oxygen through **liquefaction into insulated cryogenic tanks**. NASA-APP's initial MVP **deliberately stops at an explicitly modeled finite gaseous O₂ stockpile** so we can demonstrate real production/accumulation without pretending that oxygen is rocket-ready LOX. The separate liquefaction asset (ASSET-11) is required before claiming stored **liquid oxygen** or a propellant depot. A gas tank with increasing kg does not imply constant pressure or infinite free compression.

## Forma / OpenCAD build brief

Construct a dedicated O₂-rated conceptual buffer vessel or bank of pressure vessels on a restrained support skid; visible inlet/outlet manifold, isolation valves, flow/pressure sensors, inventory gauge, relief/vent routing, service interface and (if model uses pressurized storage) a distinct compressor module with electrical motor, stages and cooling. Separate selectable `vessel`, `valves`, `regulator`, `pressure_sensor`, `compressor`, `inlet`, `withdrawal_port` and `support`. Parametrize vessel volume m³, declared pressure/temp bounds, maximum oxygen mass, allowable fill rate, compressor ratio/efficiency and power. **Do not use visualization-only fill bars to invent gas mass.**

## Executable machine contract

- **Commands:** `accept_product(stream_id)`, `open_inlet`, `store(kg)`, `isolate`, `reserve_for_request(kg)`, `withdraw_reserved(kg)`; optional `run_compressor(target_pressure_Pa)` when enabled.
- **Inputs:** gas mass/composition, temperature K, pressure Pa, tank volume m³ and free capacity kg, available electricity W, modeled leakage/loss and optional compressor characteristics.
- **Outputs:** actual stored kg O₂, gas temperature/pressure, available versus reserved kg, energy used J, leakage/vent stream and evidence events.
- **States:** EMPTY, READY, FILLING, HOLDING, FULL, RESERVED, WITHDRAWING, ISOLATED, FAULT.
- **Model:** bounded mass transfer plus equation-of-state appropriate to declared pressure/temperature assumptions (e.g., ideal gas only within justified approximation); cap pressure, fill rate and temperature; include compressor work if pressure lift is required. `available_kg = stored_kg - reserved_kg`. A mission request **does not create oxygen**.
- **Failure paths:** full vessel, excess pressure/temperature, valve closed, inadequate compressor power, leak, insufficient inventory for reservation.

## MVP acceptance

Actual recovered output from ASSET-06 accumulates in the tank; when full, upstream flow stops or is explicitly diverted/lost by a recorded route. Pausing electrolysis and capture stops any unexplained increase. Requesting more oxygen than stored yields an honest insufficiency response; no pretend launches or deliveries.

## Technical sources

- [NASA NTRS — Lunar MRE plant model](https://ntrs.nasa.gov/citations/20240013999) (purification/liquefaction/storage architecture; distinguish our interim gas buffer).
- [NASA — Lunar Surface Technology](https://www.nasa.gov/lunar-surface-technology/) (oxygen as ISRU output and lunar infrastructure need).
- [NASA NTRS — Liquefaction for Lunar/Mars Exploration](https://ntrs.nasa.gov/api/citations/20220003516/downloads/Liquefaction%20SCW%20paper-revised.pdf?attachment=true) (example real cryogenic tank/storage considerations, *not* gaseous-buffer design specifications).
## Integration contract (NASA-APP)

- **OpenForma:** use real supported domain IR contracts and keep validation findings and assumption provenance; do not treat generated geometry or engineering reports as physical certification.
- **OpenCAD:** deliver selectable parametric components, joint/port frames, and a supported asset export for OpenIndustries.
- **OpenIndustries:** execute tasks from the authoritative controller, render live state, expose actual material/energy changes and record event evidence. No decorative motion divorced from task state.
- **Solver/controller:** accept typed commands and return bounded numerical deltas; do not allow OpenCode agents or UI animations to write physical outcomes directly.

**Status:** research-backed design brief only. Unspecified geometry sizes, efficiencies, outputs, operating limits, capacities and deployment details are **TBD scenario/design parameters**, not verified lunar hardware specifications. All telemetry in NASA-APP is simulated unless clearly marked as third-party measured reference data.
