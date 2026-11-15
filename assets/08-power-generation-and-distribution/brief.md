# ASSET-08 — Lunar plant power source, distribution bus and energy storage

**Priority:** Core MVP **as an executable budgeted electrical power subsystem**. Solar array/battery geometry may be visually compact for the first slice. **Flow:** declared power source + battery/buffer → metered loads on ASSET-01 through ASSET-10.

## Research context

NASA identifies lunar surface **generation, storage, power management and distribution** as enabling infrastructure. Solar supply depends on site and illumination; shaded/night operation may require stored or dispatchable power. NASA also studies fission systems for sustained power regardless of sunlight. **Do not assume a particular south-polar site has continuous solar power or a functioning nuclear reactor.**

## Forma / OpenCAD build brief

Create an inspectable energy center with deployable photovoltaic arrays (or a defined external-grid/power-module source), array supports, cable routing, power-control cabinet, DC distribution bus, converters/contactors, energy-storage rack, emergency isolator and per-machine feeder connectors. Separate `source`, `array_hinge`, `battery_module`, `dc_bus`, `converter`, `breaker` and `load_ports`. Parametrize peak generation W, capacity Wh, converter loss, breaker rating, cable loss, source availability function and thermal limits. A solar-tracking motion is only valid if the model has an illuminated sun vector/source model.

## Executable machine contract

- **Commands:** `allocate(load_id, requested_W)`, `throttle(load_id, max_W)`, `isolate(load_id)`, `charge`, `discharge`, `set_priority(load_id, priority)`.
- **Inputs:** time-varying source W, energy reserve Wh, per-machine demand W, conversion efficiency, transmission loss, priority rules, power/thermal conditions.
- **Outputs:** W actually delivered to each load, energy consumed/stored J or Wh, unmet demand, line loss and brownout/fault events.
- **States:** ONLINE, SHEDDING_LOAD, CHARGING, DISCHARGING, UNDERPOWERED, TRIPPED, OFFLINE.
- **Model:** enforce every tick `sum(delivered_load_W + losses_W) <= generated_W + discharged_W` and battery conservation within charge/discharge efficiency. Report solar intermittency and battery capacities as explicit scenario assumptions. Temperature and current protections must match chosen equipment bounds.
- **Failure paths:** source outage, depleted battery, overcurrent breaker trip, degraded converter and unserved thermal/reactor load.

## MVP acceptance

Lowering supply by a defined amount **causally throttles preheating/MRE** and changes oxygen production, with reconciled energy history. Agents may propose priority or setpoint changes but cannot conjure power by editing a dashboard gauge.

## Technical sources

- [NASA — Lunar Surface Technology: Surface Power](https://www.nasa.gov/lunar-surface-technology/) (solar, storage, distributed power, dust and lunar-night considerations).
- [NASA — Moon Base Systems: Power](https://www.nasa.gov/moonbase-systems/) (generation, conditioning, distribution and phase-dependent supply).
- [NASA — Fission Surface Power](https://www.nasa.gov/exploration-systems-development-mission-directorate/fission-surface-power/) (alternative, not implied deployed asset).
## Integration contract (NASA-APP)

- **OpenForma:** use real supported domain IR contracts and keep validation findings and assumption provenance; do not treat generated geometry or engineering reports as physical certification.
- **OpenCAD:** deliver selectable parametric components, joint/port frames, and a supported asset export for OpenIndustries.
- **OpenIndustries:** execute tasks from the authoritative controller, render live state, expose actual material/energy changes and record event evidence. No decorative motion divorced from task state.
- **Solver/controller:** accept typed commands and return bounded numerical deltas; do not allow OpenCode agents or UI animations to write physical outcomes directly.

**Status:** research-backed design brief only. Unspecified geometry sizes, efficiencies, outputs, operating limits, capacities and deployment details are **TBD scenario/design parameters**, not verified lunar hardware specifications. All telemetry in NASA-APP is simulated unless clearly marked as third-party measured reference data.
