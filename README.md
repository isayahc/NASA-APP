# NASA-APP — Autonomous Lunar Oxygen Foundry

**Continuous, agent-operated lunar manufacturing using the Mapped-Assembly ecosystem.**

> **Mission:** Can an autonomous lunar factory continuously extract, process, and stockpile oxygen from lunar regolith, while adapting its operations to support future exploration missions?

**Status: asset library and static OpenIndustries scene available; the autonomous factory runtime is not yet implemented.** This repository is being bootstrapped. The tree below is the **target structure**, not a claim that these code modules already exist. See [Epic #1](https://github.com/isayahc/NASA-APP/issues/1) for the implementation backlog and acceptance gates.

## Why this factory?

Space missions currently depend heavily on Earth-supplied oxygen and industrial consumables. Lunar regolith contains oxygen chemically bound in mineral oxides. **Molten regolith electrolysis (MRE)** is a proposed way to use electrical energy to extract oxygen and leave reduced metal-rich material. A continuously running plant could build a stockpile for future exploration missions, but actual production depends on finite regolith, power, equipment capacity, losses and uptime.

The question is **not** “can we animate a cool lunar base?” It is: **can a bounded, instrumented, simulated industrial process run continuously and produce defensible resource-accounted output while agents operate it?**

The primary scenario is a **hypothetical lunar south-polar factory**, with explicitly supplied feedstock composition, power, environment, machinery and imported consumables. No particular mine or landing site is claimed to be verified.

## Target MVP: a genuinely live factory

A single local demo should show an interactive **OpenIndustries** 3D production line with:

1. Excavator or executable bulk-feed source, hopper and conveyor that transfer actual material-lot inventory.
2. Preheater that consumes energy and changes temperature over simulated time.
3. MRE reactor that calculates oxygen generation from chemistry, energy, electrochemical efficiency and finite feedstock.
4. Capture/purification equipment that accounts for recovery efficiency and losses.
5. Finite oxygen gas storage whose inventory increases only from net product output.
6. **OpenCode agents** observing live telemetry and proposing bounded operating changes, which a deterministic controller can accept or reject.

**Continuous operation** means a live plant pipeline whose machines execute real tasks and move/process material. Batch machinery may operate in staggered cycles; do not label one isolated batch as a continuously fed reactor. **External mission requests are optional consumers of the stockpile, not a prerequisite for factory activity.**

### The demo moment

Run a plant, inspect real machine states and O₂ output, lower available power or change feed composition, watch the computed bottleneck affect throughput, and watch an agent respond with a validated adjustment or an honest inability-to-recover result. The 3D view and telemetry must agree with the same authoritative simulation state. No prerecorded footage, fake production curves, fictional emergency triggers, or invented chemistry results.

**The first vertical slice is smaller:** a machine transfers a tracked material lot from hopper to preheater; preheating consumes accounted energy; machine state, lot position and temperature visibly update in real time. Build this before expanding the scene.

## Core stack

| Layer | Selected technology | Purpose |
| --- | --- | --- |
| World and operations | [Mapped-Assembly/OpenIndustries](https://github.com/Mapped-Assembly/OpenIndustries) | Canonical interactive 3D scene, machines, task execution, authoritative world state and spatial contracts |
| Engineering | [Mapped-Assembly/OpenForma](https://github.com/Mapped-Assembly/OpenForma) | ChemicalIR, ProcessIR and other supported engineering domains; revisions, constraints and validation |
| Mechanical geometry | [Mapped-Assembly/OpenCAD](https://github.com/Mapped-Assembly/OpenCAD) | Parametric CAD and geometry imported via supported OpenIndustries handoffs |
| Agents | [OpenCode SDK](https://opencode.ai/docs/build/sdk) | Event-driven plant supervision, process engineering decisions and typed tool proposals |
| Numerical process model | Python 3.11+, NumPy, SciPy, Pydantic, Pint | Stoichiometry, electrochemical/thermal approximations, mass and energy balances, uncertainty, time integration |
| UI | Existing OpenIndustries TypeScript/React/Vite rendering infrastructure | Real-time machine movement, state inspection, throughput and inventory |
| Storage / verification | Existing OI storage where appropriate; SQLite, numerical tests, Playwright | Reproducible event trace, observations, provenance and browser E2E assertions |

**Use the Mapped-Assembly repositories above**, not legacy upstream URLs. Exact commit/version integration pins are still an implementation task, not something this README assumes is already done.

**Keep the chemical solver independently reusable.** It lives in NASA-APP first, consumes numerical/chemical/process inputs instead of OpenIndustries scene objects, and may later be evaluated for promotion to an optional OpenForma evaluator. It must not require a Forma core modification to demonstrate lunar chemistry.

## Runtime architecture

```text
OpenCode SDK agents
    └─ propose typed tasks and setpoint changes (never edit inventories directly)
           ↓
Command validation / resource reservations / deterministic controller
           ↓
OpenIndustries execution, task scheduler, authoritative world state
           ↔ NASA-APP Python chemical-process solver
           ↓
Events, poses, temperatures, power, streams, lot IDs, O₂ stock
           ↓
Low-latency runtime state stream → OpenIndustries interactive 3D viewer
           ↓
Operator inspection, telemetry, evidence and approvals

OpenForma engineering IR → OpenCAD geometry → supported OI assets/equipment
```

**Separate clocks:** 3D rendering targets smooth interactive frame rates; the simulation runs at appropriate numerical/control timesteps; OpenCode agents act asynchronously when events require decisions. The existing OI local scene revision sync is for durable edits, not a per-frame physics transport. Reuse/extend OI's existing simulation, machine and Field Lab facilities before introducing a new runtime or renderer.

## Planned repository structure

The directory layout below is **proposed and not yet implemented**. Components should only be created as required by an executable vertical slice.

```text
NASA-APP/
├── README.md
├── Agent.md
├── assets/                            # See assets/README.md for the asset gallery
│   ├── 01-regolith-excavator/       # Numbered machines 01–11: brief, artifacts, renders
│   ├── tools/                      # Shared CAD build, MCP and rendering utilities
│   ├── gallery/                    # Contact sheet and verification index
│   └── rassor/
│       ├── README.md
│       ├── rassor-nasa-reference.stl
│       └── rassor-nasa-reference.metadata.json
├── scenes/
│   └── lunar-foundry.plan.json       # Versioned ten-machine scene/port design
├── apps/
│   └── mission-control/
│       ├── package.json
│       └── src/
│           ├── components/             # Operator overlays; reuse OI's renderer
│           └── runtime/                # Live state stream + UI bindings
├── packages/
│   ├── chemical-process-solver/
│   │   ├── pyproject.toml
│   │   ├── src/
│   │   │   └── chemical_process_solver/
│   │   │       ├── __init__.py
│   │   │       ├── stoichiometry.py
│   │   │       ├── kinetics.py
│   │   │       ├── reactors.py
│   │   │       ├── thermodynamics.py
│   │   │       ├── balances.py
│   │   │       └── simulation.py
│   │   └── tests/
│   └── contracts/
│       ├── schemas/                    # Versioned cross-language types
│       └── README.md
├── integrations/
│   ├── forma/                          # OpenForma engineering IR + revisions
│   ├── openindustries/                 # Scene, task/runtime and asset bridge
│   ├── opencad/                        # CAD + OI geometry handoff
│   └── opencode/                       # SDK sessions, tools and event handlers
├── scenarios/
│   └── lunar-south-pole/               # Explicit simulated site assumptions
├── tests/
│   ├── integration/                    # Controller ↔ solver ↔ MA ecosystem
│   └── e2e/                            # Browser, real-time action and telemetry
├── docs/
│   ├── architecture/                   # ADRs, clocks, adapters, protocols
│   └── research/                       # Sources and calibration provenance
└── scripts/                            # One-command demo/bootstrap (future)
```

The two documents intentionally carry the **same structure**. **apps/mission-control** should be a thin host/integration surface for OpenIndustries, *not* a rewritten 3D engine or competing dashboard. The **integrations/** folders are adapters to existing APIs/CLIs; their interfaces must be confirmed against actual repository versions before implementation.

## Implementation milestones

1. **Bootstrap and integration spike:** Inspect actual OpenIndustries simulation/Field Lab APIs, OpenForma IR contracts, OpenCAD asset handoffs and the OpenCode SDK generation; pin versions and record architectural decisions.
2. **Live mechanical/material slice:** Hopper → preheater, real task state, material transfers, thermal/energy accounting and real-time 3D synchronization.
3. **Continuous MRE production:** Chemically bounded numerical model, preheat → reactor → capture → gas storage, source-backed calibration and inventory conservation tests.
4. **Autonomous operations:** OpenCode agent reads a real constraint, proposes changes through typed tools and observes controller-determined results.
5. **Cross-domain engineering:** OpenForma artifacts + OpenCAD assembly, linked to an executable OI machine; compare modeled operation before/after a revision.
6. **Later:** Production forecasts and stockpile reservations for hypothetical missions, accelerated long-run simulation, more rigorous cryogenic storage, metal processing and logistics.

See [Epic #1](https://github.com/isayahc/NASA-APP/issues/1) for full acceptance criteria and task breakdown.

## Scientific integrity and source context

NASA/Lunar Resources reported a **25 kg regolith simulant** MRE test with average oxygen output of **0.07 kg/hour over nine hours of sustained electrolysis**. Treat those figures as **ground-test reference data** for calibration and comparison, **not** a demonstration that a lunar plant can operate indefinitely. Declare any modeled efficiency, regolith composition, loss, power, degradation and lifetime assumptions.

At a minimum, test mass and oxygen conservation, charge/energy bounds, nonnegative inventory, finite storage, reproducibility and power-cut response. Always label numerical outputs **simulated** and include sources, model versions, inputs and limitations.

Primary references:

- [NASA NTRS — Large-Scale Demonstration of Molten Regolith Electrolysis](https://ntrs.nasa.gov/citations/20260006167)
- [NASA NTRS — System Modeling of a Lunar Molten Regolith Electrolysis Plant](https://ntrs.nasa.gov/citations/20240013999)
- [NASA — In-Situ Resource Utilization Development and Testing](https://www.nasa.gov/reference/jsc-in-situ-resource-utilization/)
- [NASA — Lunar Surface Technology](https://www.nasa.gov/lunar-surface-technology/)

## Running locally

**Spatial preview is runnable, not the autonomous factory.** On WSL2/Linux with Node.js 22.16+, Git and npm, run:

```bash
bash scripts/run_foundry.sh
```

This builds a real CAD-backed portable OpenIndustries scene, persists it to its local scene store, starts the existing OI workbench and prints a direct scene URL. Use `--build-only` to generate without starting a server. See [spatial integration ADR](docs/architecture/lunar-scene.md) and [issue #4](https://github.com/isayahc/NASA-APP/issues/4). The machine task/physics runtime, OpenCode orchestration and continuous oxygen production are **not yet implemented**.

When the first vertical slice is built, this section must provide a **tested one-command start**, stop/reset instructions, offline solver/test commands, and a separate OpenCode-enabled mode that documents required provider credentials. A model outage must not prevent deterministic factory simulation from running; it must simply report **autonomy disabled**.

## Contribution and agent instructions

See [Agent.md](Agent.md) for architecture ownership, coding rules, scientific correctness constraints, implementation order and test requirements.

**Scope:** Autonomous lunar oxygen manufacturing and stockpiling. This project is not a biomass experiment, an orbital repair-parts factory, or flight-qualified spaceflight software.
