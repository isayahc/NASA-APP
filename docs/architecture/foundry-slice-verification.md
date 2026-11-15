# F6 — Complete live foundry acceptance (#15)

This gate proves the **finite mechanical/material/preheat slice**, using the actual
pinned OI workbench, imported STEP assets, persistent scene, SQLite authority,
native job/resource APIs, F1 stream, F2 controls, F3 poses, F4 ledger view and F5
inspection together. It does not certify lunar physics or claim MRE/O₂ production
or autonomous decision agents.

## Genuine operator walkthrough

1. Run `bash scripts/run_foundry_live.sh` (WSL2/Linux, Node 22.16+, installed pinned
   OI dependencies). Open the printed URL. The native inspector contains **Foundry
   controls**. No provider keys or animated GIFs are required.
2. Click **Start**, then **Step**. Inspect the excavator: paid task work moves its
   actual CAD joints and transfers 1,000 g from site to cargo. Hopper remains empty.
   Step three more times: only the successful fourth delivery step credits hopper.
3. Select the hopper. Under **Operating constraints**, click **Block feeder**, then
   **Step**. The job waits, inventory and CAD work stay frozen. **Unblock feeder**
   and step: exactly 200 g transfers to preheater. Five successful steps transfer
   the complete 1,000 g delivery.
4. Select the preheater. **Cut heater power**, then **Step**: no paid heat or auger
   progress. **Restore heater power** and step: the real energy debit and modeled
   temperature increase appear together in the native inspector.
5. Choose a speed and **Resume** for automatic server-authorized steps. **Pause**
   freezes automatic work at the committed checkpoint; **Step** remains an explicit
   manual advance. Disconnecting the last operator stream stops automatic work;
   the view retains stale readings until reconnect. Reconnect does not resume the
   clock on its own. Reload recovers actual stored state.
6. Resume or step through 65 successful heating steps. The release criterion reaches
   300 K; no regolith disappears. Inspect energy, modeled loss and rounding residual.
   The terminal run stops automatically.
7. **Reset — new run** creates a fresh named instance and reloads it, while all prior
   state, events and receipts remain in SQLite. Stop the launcher with Ctrl+C.

The default operator scenario starts with 10,000 g site stock and delivers 1,000 g.
The acceptance fixture starts with **exactly 1,000 g**, making final site depletion
explicit. Both use the same versioned process rules and thermal assumptions.

## Reproducible browser gate

```bash
bash scripts/run_foundry.sh --build-only
cd vendor/openindustries
npx playwright install chromium
node --import tsx --test ../../tests/foundry_controls.test.ts
node --import tsx ../../scripts/verify_foundry_slice_browser.ts
```

`scenarios/lunar-south-pole/live-slice-e2e.json` pins the base scenario, finite source,
failure variants, viewport, speeds and exact OI commit. The script strips provider
API keys/common provider credentials from its environment and the API child. It
uses isolated ports **5181 / 8795**, fresh real SQLite files and the existing native
scene store. No synthetic instrument responses or alternative renderer are used.

### Assertions

- Start, all manual steps, speed changes, Resume/Pause, constraint changes and Reset
  use browser controls. Every command receipt's expected revision and simulated
  time are checked: exactly one configured quantum for Step/clock-step, zero for
  other actions. Invalid/unauthorized/stale requests are tested over actual HTTP.
- Four successful delivery steps, then five exact 200 g feeds. Empty-site and
  initially-full-hopper runs wait without inventing material or overflowing stock.
- At each browser checkpoint, all **71 native CAD part matrices** across excavator,
  hopper and preheater match the committed task projection. Ledger quantities and
  the selected machine's task, temperature, energy and readiness match SQLite.
- Blocked feed, zero heater power, whole-plant pause, offline/disconnect and explicit
  stream loss prevent unpaid work. Recovery retains coherent paid checkpoints.
  Captured old/out-of-order/duplicate frames and old-run frames after Reset cannot
  rewind state. The final completion receipt can be retried without spending twice.
- Full reload recovers completed part matrices, ledger/inspector readings and the
  same final authority. Reset preserves the archived run and starts at revision 1.
- **Every committed receipt**, including automatic ticks not individually rendered
  by latest-head SSE, closes integer mass and electrical/thermal balances:
  `opening mass = site + cargo + hopper + preheater`,
  `opening electricity = available + spent`, and
  `spent = sensible heat + accumulated loss + numerical residual`.
  All quantities stay nonnegative, capacities hold, and provenance is simulated/modeled.
- The entire recorded command trace is executed again in a second real SQLite
  authority and produces **identical complete snapshots**. Wall-clock scheduling
  may alter when commands arrive, but the recorded scenario/command sequence is
  deterministic. Event-history replay also matches each checked committed state.
- The durable native scene head remains unchanged. Geometry motion/inspection do
  not author scene edits. The fixture has no stochastic model or implicit seed.

### Performance measurement (not an FPS promise)

The test captures:

1. Browser `fetch` submission → accepted F1 snapshot, joined by instance/revision.
   This includes HTTP, validation, SQLite commit, transport and browser dispatch.
2. Native OI `lastCpuFrameMs` per observed draw, plus draw calls/profile/geometry
   counters. This measures CPU draw submission, **not GPU completion**.
3. Browser `requestAnimationFrame` intervals and a real pointer-drag camera
   interaction. OI renders on demand; rAF cadence is **not rendered FPS**.
4. Native machine-selection roundtrip measured by Playwright, including automation
   overhead, and observed first-tick SSE delay at every selected speed.

Each report includes sample counts, median/p95/max, actual Chromium/WebGL renderer,
viewport, OS/architecture, Node version, CPU/logical cores and RAM. Local and CI use
headless Chromium with SwiftShader, not representative demo GPU hardware. No 60 FPS
claim or portable performance threshold is inferred. Read the measurements from
the particular artifact/environment you are evaluating.

## Evidence package and CI

`.github/workflows/foundry-stream.yml` checks the pinned native OI dependency, runs
all controller/transport/control/kinematics/material/inspection suites, builds the
ten-machine scene, and runs all five native browser checks. Its existing
`f1-authoritative-stream-evidence` artifact includes `.generated/issue-15/`:

- `15-manifest.json`: exact OI/app revisions, dirty-worktree indicator, source hashes,
  imported-scene hash, fixture, environment and case counts.
- `15-normal-evidence.json`, `15-empty-site-evidence.json`,
  `15-full-hopper-evidence.json`: every receipt/request and browser checkpoint,
  conservation/reexecution evidence and native matrix fingerprints.
- `15-performance.json`: measured timing distributions, speed samples and renderer.
- Screenshots for initial/completed/reset/mobile/failure states and
  `15-complete-slice.webm`: actual browser footage.
- GitHub Actions run/step logs provide test output. Source hashes and app revision
  identify the exact implementation; a dirty local run is labeled as such.

Only media and JSON evidence are uploaded, not SQLite databases, passwords or
operator cookies. Scene/run IDs are identities, not credentials. Artifacts currently
retain the workflow's seven-day expiry; download the package for longer retention.

## Model boundaries

This is one finite batch, not a continuous oxygen-production plant. Wheel motion
is derived in place; source ports are declared engineering anchors. The lumped
preheat model evaluates heat on successful steps and does not model passive
cooling during paused/blocked steps. Material transfer history is a bounded ledger
tail and may disappear after later energy entries; inventory remains authoritative.
The inspector's resolved CAD/source hashes do not certify physical performance.
