# NASA-APP — Agent implementation instructions

This file governs coding agents and contributors implementing the **Autonomous Lunar Oxygen Foundry**. Read [README.md](README.md) and [Epic #1](https://github.com/isayahc/NASA-APP/issues/1) before proposing a change. **The repository is currently a planned architecture, not a complete running factory.** Verify code and commands before saying they work.

## Non-negotiable objective

**Build a continuous, real-time, autonomous simulated lunar factory that extracts oxygen from regolith using molten regolith electrolysis (MRE), maintains honest energy/material balances, and stockpiles usable O₂.**

The factory's work must be meaningful **without** external requests, fake failures or a cinematic script. An OpenIndustries scene must show **real task-driven machine behavior** and **actual simulated process state**. A computed failure or infeasible condition is a valid outcome. The biological/biomass laboratory is no longer this project's mission.

## Planned repository structure

**This is the target layout, not an assertion that its files currently exist.** Keep this tree synchronized with the same section in README.md as the structure evolves. Do not generate placeholder directories, fake implementations or unused abstractions merely to match the diagram.

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

## Source-of-truth stack

- **[Mapped-Assembly/OpenIndustries](https://github.com/Mapped-Assembly/OpenIndustries)** owns the spatial scene, interactive viewer, task execution/world state, and existing simulation infrastructure. Audit and extend existing simulation, Field Lab, material and robot/asset facilities before creating anything parallel.
- **[Mapped-Assembly/OpenForma](https://github.com/Mapped-Assembly/OpenForma)** owns domain engineering artifacts and constraints, especially ChemicalIR and ProcessIR, plus supported electrical, thermal, fluidic and mechanical domains. Generation/validation does **not** prove production yield or physical feasibility.
- **[Mapped-Assembly/OpenCAD](https://github.com/Mapped-Assembly/OpenCAD)** supplies actual parametric geometry and supported robot/asset exports; **geometry does not grant executable physics or kinematics**.
- **[OpenCode SDK](https://opencode.ai/docs/build/sdk)** manages agent sessions, tools and decision events. **Choose and pin a verified SDK/runtime generation**; do not mix incompatible APIs from different generations.
- **NASA-APP local Python solver** is an independently testable scientific computation package under **packages/chemical-process-solver/**, initially using Python 3.11+, NumPy, SciPy, Pydantic and Pint. Do not put OI viewer types or SDK session state into the solver.

Only these three Mapped-Assembly project dependencies are in scope. Prefer direct SDK/CLI or existing typed API integration over copy-pasting or reimplementing large upstream systems.

## Ownership boundaries

| Concern | Owner | Agent rule |
| --- | --- | --- |
| Scene geometry, spatial transforms, machine execution and live presentation | OpenIndustries integration/runtime | Never create a separate pretend renderer or update geometry via AI narrative |
| Engineering design artifacts, parts/process definitions and revisions | OpenForma integration | Preserve domain IR provenance, revisions and unresolved assumptions |
| CAD geometry | OpenCAD integration | Verify supported asset scale, axis, attachment and handoff |
| Stoichiometry, electrochemical/thermal behavior, time integration | Standalone Python solver | No LLM calculations masquerading as numerical measurements |
| Authoritative material/energy inventory, task transitions and approvals | Deterministic OI/NASA-APP controller | No direct agent-side writes to stockpiles, physics state or completion records |
| Mission/operations proposals and interpretation | OpenCode agents | Typed tool calls only, always schema-validated and logged |

**No duplicate state authority.** The controller owns accepted actions and the inventory ledger. The solver returns computed deltas/observations; OI applies valid transitions and streams the committed state. Agents propose, but the controller decides what actually happens.

## Scientific modeling rules

1. **MRE is high-temperature electrochemistry.** Model bounded oxygen from input mineral oxides, current/charge efficiency, power/voltage, temperature and process losses. Generic first-order kinetics alone are insufficient.
2. Conserve mass/elements to the precision of each declared model; oxygen generated cannot exceed oxygen-bearing feedstock or available charge/energy-derived constraints. Track reduced/residual products and capture losses rather than making regolith vanish.
3. Declare **units everywhere**; validate interfaces with typed Pydantic models and Pint. Guard against invalid states, negative material, unlimited storage, unit mismatch and numerical instability.
4. Keep the numerical core independent of the lunar site. Lunar assumptions live in scenario fixtures/adapters; the solver accepts species, streams, operating conditions and laws.
5. Base calibration on published data, including [NASA NTRS MRE demonstration](https://ntrs.nasa.gov/citations/20260006167) and [NASA plant system model](https://ntrs.nasa.gov/citations/20240013999). **25 kg simulant, 0.07 kg O₂/hour mean, nine hours sustained** are ground-test reference values, not proof of lunar reliability or a model's predictions.
6. Distinguish **measured source values, model assumptions, synthetic observations and computed outputs** in artifacts and UI. Keep model version, input scenario, seed, numerical settings, parameter provenance and error handling available for reproducibility.
7. Distinguish genuine continuous feed from an uninterrupted plant composed of discrete batch steps. Do not silently invent oxygen liquefaction, cryogenic storage, purified commercial metals or verified lunar resource deposits.

**Potential promotion to OpenForma:** Keep the package generic, independently installable and tested; consider an optional Forma evaluator only after generality, interoperability, conservation and independent benchmarks are demonstrated. Do not prematurely modify Forma core.

## Real-time and agent operation rules

- **Three clocks:** render frame cadence, deterministic physics/process integration timestep and asynchronous agent decision cadence. Never call an LLM on every frame or drive physical state from frame timing.
- OpenIndustries' durable [scene synchronization](https://github.com/Mapped-Assembly/OpenIndustries/blob/main/docs/local-scene-sync.md) polls revisions every two seconds. Use a separate live runtime stream for poses, task state and telemetry; persistent snapshots are for scene edits, event history and checkpoints.
- Machine commands must specify stable task ID, target asset, parameters, preconditions, resources, duration/transition policy and idempotency identity. Tasks validate dependencies and resource reservations before running.
- Agent calls require bounded typed tools (for example: propose feed rate, set process target, inspect telemetry, schedule transfer, request design revision, propose inventory reservation). Reject invalid or unauthorized requests with explicit reasons.
- No fake alive-state animations, repeating prefab output lines, hardcoded success/failure decisions, fictional spacecraft orders or synthetic "live" telemetry. If an agent/provider is unavailable, the plant can still run as a deterministic simulation with **autonomy disabled** clearly labeled.
- For every real operating change, link agent proposal → validation decision → task/state transition → solver inputs and outputs → displayed telemetry and evidence.
- Performance target: smooth interactive 3D (ideally 60 FPS on demo hardware) without assuming the solver or agents run at 60 Hz. Measure latency and frame performance; don't claim targets as measured achievements.

## Code and dependency standards

- **Scientific code:** Python 3.11+; always type public functions/classes, document every public class/function, use explicit units and error types, write deterministic tests. Prefer existing NumPy/SciPy/Pydantic/Pint functionality rather than building math from scratch.
- **Web and integration code:** use the TypeScript conventions and existing tooling in OpenIndustries; use strict, versioned contracts between TypeScript and Python. Check actual APIs instead of inferring names from a README.
- Prefer bounded local-first processes and a single reproducible developer command. Do not introduce a second general-purpose 3D renderer, unrelated MA product, Kubernetes, distributed queue, or cloud database solely for demo optics.
- Never commit API keys, provider tokens or secret environment values. Document configuration names with safe examples only.
- **Do not claim files, endpoints, scripts, tests, integration or performance work until actually implemented and verified**. If a task is blocked by an unsupported integration, state the limitation and build a transparent adapter or minimal validated slice.

## Delivery order and definition of done

1. **Audit and pin:** Identify OI simulation/task/asset contracts, OpenForma IR schemas, OpenCAD exports and current OpenCode SDK; record commit SHAs and integration ADRs.
2. **First executable slice:** hopper → tracked material transfer → energy-consuming preheater → real OI pose/state/inventory stream and browser inspection.
3. **Numerical MRE:** preheater → reactor → oxygen recovery → finite stockpile, with chemistry/power/resource conservation and honest calibration.
4. **Agent loop:** an OpenCode agent observes a power/feed/storage constraint and proposes a controller-validated adjustment; outcome actually changes state.
5. **Engineering loop:** real Forma ChemicalIR/ProcessIR artifact and OpenCAD assembly; revision provenance and executable-model compatibility.
6. **Later:** mission stockpile reservations, faster-than-real-time planning, detailed liquefaction/metal processing and long-horizon robustness.

**Every completed vertical slice needs** runnable startup/test instructions; numerical/unit and machine-transition tests; an integration test that checks inventory/power transitions; a Playwright browser test that inspects actual scene motion and telemetry; and traceable evidence. A screenshot, prerecorded video, green-looking UI, or passing tests over mocked data alone does not satisfy real-time integration acceptance.

## Required failure-path tests

- Exhausted feedstock → production halts; no negative regolith.
- Insufficient electrical power → heater/reactor throttle or stop; oxygen does not increase.
- Tank full → downstream processing blocks or redirects according to explicitly modeled logic.
- Invalid stoichiometry/oxygen yield → model rejects output rather than fabricating supply.
- Stalled transfer → downstream machine cannot consume a lot never delivered.
- Agent timeout or rejected proposal → deterministic plant remains consistent and autonomy state is reported honestly.
- Fixed scenario/seed and solver version → reproducible numerical traces within documented tolerance.

## Coordination

- The tracked acceptance contract is [GitHub Epic #1](https://github.com/isayahc/NASA-APP/issues/1). Implement small, reviewable changes with tests and evidence instead of sprawling speculative frameworks.
- Update **README.md** and **Agent.md** together whenever the directory layout, source-of-truth boundaries or MVP acceptance meaning changes.
- Cite source pages for factual scientific claims. Record unsupported assumptions instead of presenting them as NASA measurements.
