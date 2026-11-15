# Finite regolith transfer + preheat — OI-native runtime (Issue #5)

**Scope:** The first executable material/thermal simulation slice. It does **not** run molten regolith electrolysis or produce oxygen. The 3D scene in #4 is still a static import; the live pose/telemetry stream is #6.

## Proven existing platform primitives

This implementation directly imports **Mapped-Assembly/OpenIndustries** (pinned at `838ea330296148621f7a23f7cb647b11e73b5184`):

- `server/simulation/jobs.ts` — validated, dependency-aware `createJobSchedule`, `enqueueJob`, `advanceJobSchedule`, `controlJob`.
- `server/simulation/resource-balances.mjs` — shared **v2** bounded, immutable, conservation-checked `createResourceBalances`/`settleResourceBalances` (regolith in integer **grams**, power energy in integer **millijoules**).
- `server/simulation/commands.mjs` — revision-checked idempotent `executeTransactionalCommand` receipts.
- `server/simulation/sqlite-authority.mjs` — native local auth, transactional SQLite and no remote backend.
- `server/simulation/events.mjs` — hashed, replayable `SqliteEventHistory` committed in the same SQLite transaction.
  
The scenario-bound material/thermal formulas live in `integrations/openindustries/foundry-runtime.ts`. These are **domain policy**; there is **no second resource ledger, scheduler or independent in-memory authority**. The OI Field Lab recipes and model results are not reused.

## Run

Use Node.js >=22.16, the already pinned `vendor/openindustries` checkout and `npm ci --prefix vendor/openindustries`. From NASA-APP root:

```bash
export NASA_FOUNDRY_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
(cd vendor/openindustries && node --import tsx ../../scripts/run_foundry_sim.ts \
  --db ../../.generated/foundry.sqlite \
  --scenario ../../scenarios/lunar-south-pole/first-transfer.json \
  --ticks 86)
```

The CLI **registers/authenticates a real local operator**, creates an isolated factory instance, executes the signed/revision-checked `start` and `step` commands and verifies the event-history replay matches the committed head. It writes `.generated/first-transfer-evidence.json` with the actual time-series material/energy/temperature states.

The SQLite database is persistent. A repeat run creates a new instance instead of silently resetting/deleting old history. A provider key is unnecessary. Never commit a demo password or database to Git.

Power-failure example:

```bash
(cd vendor/openindustries && node --import tsx ../../scripts/run_foundry_sim.ts \
  --ticks 96 --cut-power-at 10 --restore-power-at 20)
```

## Actual process states and models

The code matches the first three stable #4 scene machine IDs: `foundry-machine-01` (excavator), `foundry-machine-02` (hopper/auger), `foundry-machine-03` (preheater). The default scenario is `scenarios/lunar-south-pole/first-transfer.json`.

1. **Delivery:** a real 1,000 g named regolith lot moves **source → cargo** at pickup; only after four paid task ticks does it move **cargo → hopper**. A stalled/paused delivery cannot credit the hopper.
2. **Metering:** a downstream-dependent OI job transfers **200 g per tick** from hopper to the preheater's WIP inventory. It blocks if the feeder is disabled, the hopper is depleted, or preheater capacity is exceeded.
3. **Preheat:** after the material arrives, a real OI job draws available electricity and integrates a **bounded lumped thermal model (with an explicit numerical-rounding energy residual)**. Electrical power W and duration ms convert to ledger millijoules; heat capacity and loss coefficients determine millikelvin temperature increments. The task cannot declare output ready before reaching its target.
4. **Storage:** the same OI ledger reconciles all mass accounts (site + cargo + hopper + preheater) and energy accounts (battery + spent) on every step, including fault/retry checkpoints. No mass or energy is implicitly issued.

Machine modes are derived from the scheduler's real job states, and observations are marked `origin=simulated, validity=modeled`, with source lot/provenance, task IDs and model revision. The command set is `start`, `step`, `set-power`, `set-feeder-blocked`, `pause`, `resume`, `cancel`.

**No real-world physics claims:** lunar regolith composition, heat capacity, power, transfer rates, temperature targets and losses are declared assumptions. The model is deliberately first-order; it isn't a furnace-design solver, a high-temperature material model, or proof of process feasibility.

## Validation

```bash
(cd vendor/openindustries && node --import tsx --test ../../tests/foundry_runtime.test.ts)
```

This tests source → cargo → hopper → preheater → heat, a power interruption, resumed power, blocked feeder, empty source, full hopper, cancellation, duplicate commands with incompatible retries, pause/resume, same-file SQLite restart, exact OI event-history replay, and rejected invalid power commands. GitHub Actions runs the tests against the pinned real OI code and saves the final evidence file for inspection.

**Next:** #6 binds scheduler state and material lots to the actual OpenIndustries 3D scene via a live runtime transport. This issue intentionally does not emit fake GIFs, invented wheel motion or oxygen curves.
