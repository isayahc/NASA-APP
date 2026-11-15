# ASSET-11 — Oxygen liquefaction, cryogenic storage and mission-supply interface

**Priority:** **Post-MVP / Phase 2**. Do not block the first continuous-production showcase on cryogenic engineering. **Flow:** purified gaseous oxygen from ASSET-06 or buffer ASSET-07 → cryocooler/liquefier → finite LOX insulated storage → potential future mission supply.

## Research context

The NASA lunar MRE plant model includes **O₂ liquefaction with a 90 K-class cryocooler and insulated cylindrical oxygen tanks**, because liquid oxygen is much denser than gas and useful for rocket oxidizer supply. NASA Glenn studies integrate refrigeration tubes with tank surfaces and examine pressure, phase changes, cooling and reduced gravity. The **MVP gaseous inventory is not LOX**; this subsystem must be built and numerically evaluated before the project can accurately claim to operate a lunar propellant stockpile.

## Forma / OpenCAD build brief

Design an inspectable cryogenic process skid: incoming gaseous O₂ conditioning manifold, cryocooler cabinet, cold-head/heatexchanger, refrigerant loop, insulated cylindrical tank, multilayer insulation representation, inner liquid region, ullage region, pressure and temperature instrumentation, controlled vent/relief, valves and future transfer port. Separate the tank shell/insulation/coolant-loop modules and show true gas/liquid fill fractions only when dictated by the thermodynamic model. Use NASA Glenn tank photos as **design context**, not permission to claim identical specifications or performance. Parametrize thermal load, active cooler W input/cooling capacity W, tank volume, heat leaks, allowable pressure, oxygen purity and mass-transfer capacity.

## Executable machine contract

- **Commands:** `enable_cryocooler`, `accept_o2_gas(stream_id)`, `liquefy`, `store_lox`, `hold`, `vent`, `prepare_transfer` (approval-gated).
- **Inputs:** species-resolved, purity-checked gas; inlet T/P/flow; cooler electricity and cooling capacity; latent/sensible enthalpy; ambient radiative environment; tank liquid/ullage inventory and pressure.
- **Outputs:** gaseous O₂ mass, liquid O₂ mass, losses/boil-off, temperature/pressure, cooler energy and fill/quality evidence.
- **States:** WARMING_UP, COOLING, LIQUEFYING, HOLDING, FULL, OFF_SPEC, OFFLINE, FAULT.
- **Numerical model:** energy to remove sensible heat and enthalpy of vaporization; finite cooling power, heat leak, two-phase inventory and explicit vent losses. **No instantaneous phase transition, infinite cooling or silently zero boil-off.** Make any simplified saturation-pressure/equilibrium assumption explicit.
- **Failure paths:** cooler offline, O₂ purity inadequate, tank too warm/full, thermal leak, pressure over limit, insufficient power.

## Phase 2 acceptance

Liquefied quantity rises only after a sufficient energy-removal calculation; gas oxygen is subtracted, power is consumed and tank pressure/thermal state are bounded. A mission can reserve actual available LOX but cannot load a spacecraft or claim delivery absent a separately implemented logistics model.

## Technical sources

- [NASA NTRS — Lunar MRE plant system model](https://ntrs.nasa.gov/citations/20240013999) (90 K cryocooler and insulated cylindrical LOX storage).
- [NASA NTRS — Gravitational effects on liquefaction for Lunar and Mars exploration](https://ntrs.nasa.gov/api/citations/20220003516/downloads/Liquefaction%20SCW%20paper-revised.pdf?attachment=true) (tank cooling, MLI and phase balance research).
- [NASA NTRS — Basic Cryogenic Propellant Storage Approaches](https://ntrs.nasa.gov/api/citations/20240001073/downloads/AIAA-LPTC-ShortCourse_CFM-Kassemi-Updated_2-5-2024.pdf) (90 K active cooling / zero-boil-off concepts; not assumed already achievable here).
## Integration contract (NASA-APP)

- **OpenForma:** use real supported domain IR contracts and keep validation findings and assumption provenance; do not treat generated geometry or engineering reports as physical certification.
- **OpenCAD:** deliver selectable parametric components, joint/port frames, and a supported asset export for OpenIndustries.
- **OpenIndustries:** execute tasks from the authoritative controller, render live state, expose actual material/energy changes and record event evidence. No decorative motion divorced from task state.
- **Solver/controller:** accept typed commands and return bounded numerical deltas; do not allow OpenCode agents or UI animations to write physical outcomes directly.

**Status:** research-backed design brief only. Unspecified geometry sizes, efficiencies, outputs, operating limits, capacities and deployment details are **TBD scenario/design parameters**, not verified lunar hardware specifications. All telemetry in NASA-APP is simulated unless clearly marked as third-party measured reference data.
