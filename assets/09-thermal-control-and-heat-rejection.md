# ASSET-09 — Plant thermal management, insulation and heat rejection

**Priority:** Core MVP as **a working thermal balance and visible support subsystem**, with simplified radiator/cooling hardware; detailed lunar radiator engineering is post-MVP. **Flow:** heater/reactor/electronics excess heat → modeled insulation losses / heat rejection → environmental boundary.

## Research context

The MRE process reaches extremely high temperatures and NASA system modeling explicitly varies reactor insulation and wall-temperature limits when sizing feasible systems. Lunar hardware also operates under harsh environmental temperature cycles. A factory can't be “sustainable” if its reactor, cables, seals, instruments or storage exceed their operating temperatures; heat and active cooling costs must be included in the energy ledger.

## Forma / OpenCAD build brief

Create a radiator bank or deployable panel assembly, coolant-loop manifold/pump unit when a loop is included, insulation shrouds on hot process equipment, heat exchanger block, temperature probes and line routing. Keep `radiator_panel`, `radiator_hinge`, `coolant_pump`, `heat_exchanger`, `thermal_lines`, `insulation` distinct for interaction. Geometric placement should avoid pretending the radiator dumps heat into a warm atmosphere: model radiation to a declared sky/terrain view factor/environment, or explicitly use a simplified loss-to-sink boundary.

## Executable machine contract

- **Commands:** `enable_cooling`, `set_pump_rate`, `deploy_radiator`, `isolate_zone`, `reduce_thermal_load`.
- **Inputs:** source temperatures K, mass/heat capacity, supplied heat W, thermal conductances, radiative properties/view factors or bounded lumped loss model, cooling pump electricity W and environmental scenario.
- **Outputs:** heat transferred/rejected J, radiator/loop temperature K, pump energy J, subsystem hot/cold alarms and resulting allowable process power.
- **States:** STANDBY, COOLING, SATURATED, BLOCKED, OVER_TEMPERATURE, OFFLINE.
- **Model:** compute `dU/dt = heat_in - heat_out` for each thermal node. If using radiation, bound `Q = epsilon*sigma*A*F*(T_hot^4 - T_env^4)` with declared idealizations; no free instantaneous cooling. The reactor/plant consumes power and imposes temperatures on dependent components.
- **Failure paths:** radiator blocked, pump power lost, heat-rejection capacity exceeded, nighttime thermal extremes, sensor invalid.

## MVP acceptance

When reactor/heater loads increase, computed thermal states and heat-rejection demands change; insufficient cooling or excessive temperature blocks/throttles operation rather than leaving all machines nominal. The radiator's visual/deployment state follows real commands.

## Technical sources

- [NASA NTRS — Lunar MRE plant system model](https://ntrs.nasa.gov/citations/20240013999) (reactor insulation and wall temperature feasibility sensitivity).
- [NASA — Lunar Surface Technology](https://www.nasa.gov/lunar-surface-technology/) (thermal constraints for lunar infrastructure and mobile systems).
- [NASA — IPEx TRL-5 Design Overview](https://ntrs.nasa.gov/citations/20240008162) (dust-aware autonomous hardware thermal/radiator design example; **not** a furnace cooling design).
## Integration contract (NASA-APP)

- **OpenForma:** use real supported domain IR contracts and keep validation findings and assumption provenance; do not treat generated geometry or engineering reports as physical certification.
- **OpenCAD:** deliver selectable parametric components, joint/port frames, and a supported asset export for OpenIndustries.
- **OpenIndustries:** execute tasks from the authoritative controller, render live state, expose actual material/energy changes and record event evidence. No decorative motion divorced from task state.
- **Solver/controller:** accept typed commands and return bounded numerical deltas; do not allow OpenCode agents or UI animations to write physical outcomes directly.

**Status:** research-backed design brief only. Unspecified geometry sizes, efficiencies, outputs, operating limits, capacities and deployment details are **TBD scenario/design parameters**, not verified lunar hardware specifications. All telemetry in NASA-APP is simulated unless clearly marked as third-party measured reference data.
