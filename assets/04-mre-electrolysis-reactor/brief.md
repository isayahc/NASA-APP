# ASSET-04 — Molten regolith electrolysis (MRE) reactor

**Priority:** Core MVP, the principal machine. **Flow:** hot regolith + electrical energy → crude O₂ gas (ASSET-05) + reduced/residual molten solids (ASSET-10).

## Research context

NASA/Lunar Resources LR-1 test processed **25 kg of lunar regolith simulant**, averaging **0.07 kg O₂/h** during **nine hours of sustained electrolysis under vacuum**. These are **reference ground-test results**, not a guaranteed continuous lunar factory rate. NASA's MRE system study models reactor energy, electrical current, thermal constraints, regolith composition and produced oxygen/byproducts. The process is high-temperature electrochemistry: oxygen-bearing mineral oxides undergo reduction at the cathode and O₂ evolution at the anode, while electrical/Joule heating supports the molten state.

## Forma / OpenCAD build brief

Generate a heavily insulated refractory vessel containing a molten bath, **separate anode/cathode assemblies**, high-current bus bars/feedthroughs, lid/gas hood, feed port, oxygen outlet, metal/slag withdrawal port, thermal sensor ports, support/skid, and removable inspection/maintenance panels. Use an **exploded engineering assembly** only as a view of the real parametric parts. Parameterize reaction-zone radius/height, electrode spacing and area, lining thickness, thermal insulation, current/voltage limits, feed residence time and vessel limits; all values require a model assumption/source. A glowing cutaway melt is an optical indicator **only** when controller temperature/melt state warrants it.

## Executable machine contract

- **Commands:** `charge(lot_id)`, `heat_to_melt(target_K)`, `set_current(A)`, `run_electrolysis(duration_s)`, `reduce_load`, `tap_products`, `shutdown`.
- **Inputs:** oxide species masses kg, inlet temperature K, electrical current A/voltage V, available power W, heat loss/lining properties, operating time s, efficiency/conversion assumptions.
- **Outputs:** evolved O₂ mol and kg, gas composition, reduced metals/residual solids kg, reactor temperature K, electricity kWh, remaining feed, efficiency and fault reports.
- **States:** EMPTY, CHARGED, PREHEATING, MOLTEN, ELECTROLYZING, DRAINING, COOLING, BLOCKED, FAULT.
- **Numerical constraints:** enforce available oxide oxygen inventory **and** Faraday/charge limit: theoretical `n(O2) <= I*t/(4*F)` for a one-zone/constant-current ideal bound; apply explicit current efficiency and gas-capture losses separately. Check material and oxygen mass closure; heater/ohmic losses and energy balance. A reactor with cold solid feed cannot instantly run electrolysis or create product gas.
- **Failure cases:** unmolten batch, inadequate voltage/current/power, full downstream gas vessel, excess temperature, insufficient feed, degraded electrode, blocked tap.

## MVP acceptance

The reactor starts from a finite composition-labeled batch, heats to valid conditions, only then produces modeled O₂, consumes source oxygen/charge/energy and records reduced/residual products. A power cut lowers or halts computed output; tank gains cannot continue by animation alone. Compare a documented model scenario to the NASA LR-1 ground-test reference while clearly labeling the model assumptions.

## Technical sources

- [NASA NTRS — Large-Scale MRE Demonstration (2026)](https://ntrs.nasa.gov/citations/20260006167) (measured 25 kg / ~0.07 kg/h / 9 h reference).
- [NASA NTRS — Lunar MRE plant model](https://ntrs.nasa.gov/citations/20240013999) (thermal, electrical, material streams).
- [NASA NTRS — Molten Regolith Electrolysis: Core Sample Analysis](https://ntrs.nasa.gov/api/citations/20250005608/downloads/MRE_SRR_Core_presentation.pdf?attachment=true) (electrode arrangement and four-electron O₂ stoichiometry; diagram, not a ready-to-build drawing).
## Integration contract (NASA-APP)

- **OpenForma:** author the indicated MechanicalIR/ElectricalIR/FluidicIR/ThermalIR/ProcessIR/ChemicalIR artifacts only where real supported schemas and capabilities exist. Maintain source, validation result and model/version provenance.
- **OpenCAD:** create a real parametric/assemblable asset with named separate moving parts, joints and attachment frames; export through an existing supported OpenIndustries handoff. Do not imply a mesh alone implements physics.
- **OpenIndustries:** attach the asset to a stable scene object with machine/task IDs. Machine state and real execution events drive pose, material transfer and telemetry; no canned footage or free-running decorative animation.
- **Controller:** only validated commands can transition this device; the Python numerical process solver returns physically bounded deltas/measurements and never manipulates the viewer.

**Status:** design brief only. All dimensions, performance parameters, efficiencies and operating limits not explicitly identified as published references are **TBD engineering inputs**, not NASA specifications. This is a simulated machine, not a space-qualified build.
