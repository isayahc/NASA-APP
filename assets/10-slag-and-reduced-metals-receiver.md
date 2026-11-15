# ASSET-10 — MRE byproduct, unreacted slag and reduced-metals receiver

**Priority:** Core MVP **for a physically accounted waste/byproduct outlet**. Refinery/metal manufacturing is beyond MVP. **Flow:** ASSET-04 molten/residual material → contained, finite byproduct inventory → cooling/holding for future processing.

## Research context

Molten regolith electrolysis yields O₂ and **reduced metal-rich products / residual oxide phases**. NASA's 2024 MRE system study explicitly notes that a downstream mature **metal tapping/refinement model was missing**, so its modeled metal-alloy stream **terminated at the reactor output**. The poster identifies metal processing and beneficiation as development gaps. We should model and *show* where mass goes, while avoiding a false claim that the factory can already produce certified metal ingots or finished spacecraft parts.

## Forma / OpenCAD build brief

Construct a high-temperature-compatible conceptual tapping spout/casting channel (only where the solver supports it), secondary containment vessel, covered slag bin and cooling/holding tray with removable cassettes. Make `reactor_outlet`, `tap_gate`, `receiver`, `slag_bin`, `cooling_tray`, `service_port` separate and clearly labeled. Parameterize receiver kg capacity, max incoming temperature, fill fraction, cooling/solidification time and accepted phase/species list; design parameters remain assumptions, not NASA flight hardware.

## Executable machine contract

- **Commands:** `prepare_receiver`, `accept_byproduct(lot_id)`, `tap_from_reactor`, `hold_for_cooling`, `seal_batch`.
- **Inputs:** specific reduced-metal and residual oxide masses by species kg, sensible/latent enthalpy assumptions, vessel capacity, wall/ambient temperature and time.
- **Outputs:** tagged byproduct lots by mass/composition/temperature, remaining reactor mass, cooling load and receiver-capacity events.
- **States:** EMPTY, READY, RECEIVING, COOLING, HOLDING, FULL, BLOCKED, FAULT.
- **Model:** preserve **all non-gaseous products** (including unreacted regolith and other residue); don't credit `pure Fe` or `pure Si` without a valid separation/chemistry model. A full receiver blocks/pauses reactor product handling, never deletes solids to make space.
- **Failure paths:** receiver full, hot transfer unauthorized, excessive temperature, tapping hardware blocked, missing lot identity.

## MVP acceptance

Each reactor process step has a reconciled non-gas output. Byproduct container fill/temperature visibly changes with computed transfers, and bounded receiving capacity can affect reactor throughput. The UI labels the output **unrefined byproduct / slag**, not saleable manufactured metal.

## Technical sources

- [NASA NTRS — System Modeling of a Lunar MRE Plant](https://ntrs.nasa.gov/citations/20240013999) (metal-processing technology gap and truncated output stream).
- [NASA NTRS — 2024 MRE plant poster](https://ntrs.nasa.gov/api/citations/20240013999/downloads/LISC%20Fall%202024%20MRE%20Poster_v3.pdf?attachment=true) (cathode metals, unreacted oxides, omitted metal depot/beneficiation).
- [Guerrero-Gonzalez & Zabel — System analysis of ISRU metals/O₂ plant (2023)](https://www.uni-bremen.de/en/hospo/news/details/system-analysis-of-an-isru-production-plant-extraction-of-metals-and-oxygen-from-lunar-regolith) (comparative plant trade study, **not** a validated output refinery).
## Integration contract (NASA-APP)

- **OpenForma:** use real supported domain IR contracts and keep validation findings and assumption provenance; do not treat generated geometry or engineering reports as physical certification.
- **OpenCAD:** deliver selectable parametric components, joint/port frames, and a supported asset export for OpenIndustries.
- **OpenIndustries:** execute tasks from the authoritative controller, render live state, expose actual material/energy changes and record event evidence. No decorative motion divorced from task state.
- **Solver/controller:** accept typed commands and return bounded numerical deltas; do not allow OpenCode agents or UI animations to write physical outcomes directly.

**Status:** research-backed design brief only. Unspecified geometry sizes, efficiencies, outputs, operating limits, capacities and deployment details are **TBD scenario/design parameters**, not verified lunar hardware specifications. All telemetry in NASA-APP is simulated unless clearly marked as third-party measured reference data.
