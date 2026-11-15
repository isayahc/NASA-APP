# NASA-APP — Autonomous Lunar Oxygen Foundry

**Continuous, agent-operated lunar manufacturing using the Mapped-Assembly ecosystem.**

> **Mission:** Can an autonomous lunar factory continuously extract, process, and stockpile oxygen from lunar regolith, while adapting its operations to support future exploration missions?

**Status: live finite regolith delivery, metering and energy-accounted preheat are implemented and browser-tested in native OpenIndustries.** Operator controls, CAD motion, material balances and inspection share the same SQLite authority. Autonomous operation and MRE oxygen production remain future work. The tree below includes **target structure**, not a claim that every proposed module exists. See [Epic #1](https://github.com/isayahc/NASA-APP/issues/1).

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
│   │   ├── foundry-runtime.ts         # Actual OI-native task/resource domain
│   │   ├── foundry-controls.ts        # Local authenticated commands and server clock
│   │   ├── foundry-controls-browser.mjs # Native OI operator controls
│   │   ├── foundry-sse.ts             # Read-only committed revision stream
│   │   ├── foundry-browser-stream.mjs # Monotonic browser subscriber
│   │   ├── foundry-kinematics-map.mjs # Source-verified CAD joint bindings
│   │   ├── foundry-kinematics.mjs     # Pure committed-progress joint poses
│   │   ├── foundry-kinematics-browser.mjs # Ephemeral native OI view adapter
│   │   ├── foundry-material.mjs       # Validated lot/account/posting projection
│   │   ├── foundry-material-map.mjs   # Reuse declared OI machine port anchors
│   │   ├── foundry-material-browser.mjs # Ledger meters and spatial annotations
│   │   ├── foundry-inspection-map.mjs  # Verify actual STEP/MechanicalIR source pins
│   │   ├── foundry-inspection-store.mjs # F1 snapshot/freshness subscription
│   │   ├── foundry-inspection-browser.mjs # Native System Inspector runtime section
│   │   ├── foundry-inspection.css      # Native inspector responsive layout
│   │   └── vite.foundry.config.ts     # Plugin for original OI Vite UI
│   ├── opencad/                        # CAD + OI geometry handoff
│   └── opencode/                       # SDK sessions, tools and event handlers
├── scenarios/
│   └── lunar-south-pole/
│       ├── first-transfer.json        # Finite, modeled regolith/energy inputs
│       └── live-slice-e2e.json        # Complete browser acceptance fixture
├── tests/
│   ├── foundry_runtime.test.ts        # Actual OI SQLite/task/resource integration
│   ├── foundry_controls.test.ts       # HTTP auth/receipts, clock leases, atomic reset
│   ├── foundry_stream.test.ts         # SSE ordering, read-only and reconnection
│   ├── foundry_kinematics.test.ts     # Real CAD transforms and frozen failure paths
│   ├── foundry_material.test.ts       # Finite lot balances and settled transfers
│   ├── foundry_inspection.test.ts     # Durable transitions and engineering pins
│   ├── integration/                    # Controller ↔ solver ↔ MA ecosystem
│   └── e2e/                            # Browser, real-time action and telemetry
├── docs/
│   ├── architecture/                   # ADRs, clocks, adapters, protocols
│   └── research/                       # Sources and calibration provenance
└── scripts/
    ├── run_foundry.sh                 # Static OI scene launcher
    ├── run_foundry_sim.ts            # Headless material/thermal simulation
    ├── init_foundry_live.ts          # Persistent stream source setup
    ├── run_foundry_live.sh           # Launch OI with SSE transport
    ├── advance_foundry_live.ts       # CLI-only explicit real controller steps
    ├── verify_foundry_stream_browser.ts # Native OI Chromium SSE evidence
    ├── verify_foundry_kinematics_browser.ts # Native part-matrix/browser evidence
    ├── verify_foundry_material_browser.ts # Ledger quantities and port evidence
    ├── verify_foundry_inspection_browser.ts # Native live inspection and freshness
    └── verify_foundry_slice_browser.ts # Complete controls-to-preheat evidence/performance
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

### Windows PowerShell — native live factory

From your NASA-APP checkout, with Windows Node.js 22.16+ and Git installed:

```powershell
.\scripts\run_foundry_live.ps1
```

This launches the **real OpenIndustries live workbench** (not just the static CAD lineup), initializes the persistent SQLite controller, and opens its browser URL. In **Foundry controls**, choose **Start** then **Step** or **Resume** to see committed tasks reflected in the CAD, material balances and inspector. Use `-BuildOnly` to prepare the scene without services, `-NoBrowser` to avoid opening a tab, or `-UseWsl` to invoke the original Bash launcher from PowerShell. See [native Windows setup and diagnostics](docs/architecture/windows-launcher.md).

### WSL2/Linux — existing Bash path

**Spatial preview is runnable, not the autonomous factory.** On WSL2/Linux with Node.js 22.16+, Git and npm, run:

```bash
bash scripts/run_foundry.sh
```

This builds a real CAD-backed portable OpenIndustries scene, persists it to its local scene store, starts the existing OI workbench and prints a direct scene URL. Use `--build-only` to generate without starting a server. See [spatial integration ADR](docs/architecture/lunar-scene.md) and [issue #4](https://github.com/isayahc/NASA-APP/issues/4). For controller-driven joint poses, use the live launcher below. OpenCode autonomy and oxygen production remain unfinished.

### Run the executable regolith/preheat slice (without a browser)

After installing the pinned OI checkout via `bash scripts/run_foundry.sh --build-only`:

```bash
export NASA_FOUNDRY_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
(cd vendor/openindustries && node --import tsx ../../scripts/run_foundry_sim.ts --ticks 86)
```

This produces `.generated/first-transfer-evidence.json` and an authenticated, persistent SQLite simulation of a real finite regolith lot moving from source to cargo, hopper and preheater. The model consumes electrical energy and calculates bounded temperature changes. Its measurements are simulated, not lunar experiments.

To run the CI-tested failure paths:

```bash
(cd vendor/openindustries && node --import tsx --test ../../tests/foundry_runtime.test.ts)
```

See [the OI-native runtime ADR](docs/architecture/foundry-runtime.md) and [issue #5](https://github.com/isayahc/NASA-APP/issues/5). This command runs headlessly; the live launcher connects committed state to the OI view. No provider credential is needed, and the runtime currently has no agent decisions; do not label it autonomous.

## F1 — Live authoritative runtime snapshots in the OpenIndustries browser

Issue #6 feature F1 adds a **read-only Server-Sent Events stream** to the existing OI workbench. It observes the actual finite-regolith OI SQLite controller and shows real committed job/inventory/temperature revisions, without advancing simulation time, animating machinery or rewriting OI's 3D renderer.

```bash
bash scripts/run_foundry_live.sh
```

After launch, open the printed local scene URL. Use **Start**, then **Step** or **Resume** in the native inspector. **Pause** stops automatic work; **Reset — new run** preserves prior history. Select a machine to inspect its actual simulated state. The [operator walkthrough](docs/architecture/foundry-slice-verification.md) covers transfers, constraints and preheat. The CLI remains available for explicit steps while paused.

### F2 — Authoritative operator controls

Start/Step/Pause/Resume/Reset and 0.25×/1×/2×/4× speed execute real native OI
commands through a separate authenticated local bridge. SSE remains read-only.
Disconnecting the last operator stream stops the server clock; reconnecting never
pays catch-up work. See [control semantics and local access](docs/architecture/foundry-controls.md).

### F3 — Task-driven CAD joints

The live launcher also applies committed work progress to the actual excavator
wheels, arms/drums/scoops, hopper gate/screw and preheater auger. All poses are
**simulated/derived**; wheel articulation is in place with no terrain or travel
physics. Pause, blocked work, power loss and disconnection freeze progress.
Refresh/reconnect rebuild the pose from the committed head, without scene edits.
See the [joint audit, mapping policy and browser verification](docs/architecture/foundry-kinematics.md).

### F4 — Real regolith-lot balances

The live view shows the same finite lot across site, cargo, hopper and preheater,
with integer grams/kilograms, mass-capacity meters, composition assumptions and
ledger ownership. Quantity labels use the existing machine port anchors; dotted
lines are labeled **settled transfer history**, not live particle flow. The feeder
is a pass-through with no invented inventory. Default delivery is 1,000 g followed
by five settled 200 g feed steps. See [material behavior and browser tests](docs/architecture/foundry-material.md).

### F5 — Native live machine inspection

Select an excavator, hopper or preheater in OI's System Inspector or scene collection.
Its **Foundry runtime** section shows committed jobs/phases/transitions, lot masses
and, for the preheater, electrical/thermal readings with units. Source links serve
the actual hash-verified STEP and MechanicalIR files. Unimplemented machines show
unavailable telemetry; disconnected/overdue streams retain values marked **STALE**.
See the [operator walkthrough and browser verification](docs/architecture/foundry-inspection.md).

### F6 — Complete live-slice verification

`scripts/verify_foundry_slice_browser.ts` drives the actual browser controls through
a finite 1,000 g source lot and complete preheat. It compares 71 native CAD part
matrices, inventories and inspector values against SQLite, checks **every command
receipt's mass/electrical/thermal balance**, reproduces the trace in a second
authority, and covers failures, disconnect, stale messages, reload and reset.
It records measured timing distributions, environment/source pins, screenshots,
video and JSON evidence. See [reproduction and evidence](docs/architecture/foundry-slice-verification.md).

## Contribution and agent instructions


See [Agent.md](Agent.md) for architecture ownership, coding rules, scientific correctness constraints, implementation order and test requirements.

**Scope:** Autonomous lunar oxygen manufacturing and stockpiling. This project is not a biomass experiment, an orbital repair-parts factory, or flight-qualified spaceflight software.
