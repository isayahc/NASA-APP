# F5 — Live inspection inside the native OI System Inspector (#14)

Launch `bash scripts/run_foundry_live.sh`, then select **Regolith Excavator**,
**Hopper and Screw Feeder**, or **Preheating Auger** in OI's existing System
Inspector. Selecting an asset in OI's scene collection or viewport uses the same
selection state. The new **Foundry runtime** section appears within that machine's
native Binding details, alongside the existing engineering notes. There is no
second renderer or independently selected machine dashboard.

## Operator walkthrough

1. Open the printed local scene URL. Select the excavator. The inspector shows
   `not started`, the original source stock, empty cargo, and revision 1 for a
   fresh runtime. All readings are explicitly `origin: simulated`, `validity: modeled`.
2. From a second terminal, use the real controller command in the
   [F1 walkthrough](foundry-stream.md#launch-on-wsl2--linux):
   `node --import tsx ../../scripts/advance_foundry_live.ts --ticks 1` from the OI
   checkout, with the documented database/password/instance environment. The first
   invocation queues jobs and advances one successful delivery step. Inspect the
   excavator's job/phase and the 1,000 g cargo lot. The hopper has no early credit.
3. Advance three further ticks. Select the hopper: delivery has settled, with
   1,000 g in hopper stock. Advance five ticks to meter five real 200 g postings.
4. Select the preheater and advance another tick. Its temperature, applied-power
   record, electrical spend, heat input/loss, and rounding residual come directly
   from the committed controller. Expand **Verified engineering sources** to
   download its actual STEP and MechanicalIR and see their SHA-256 pins.
5. Reload: selection can be chosen again and the latest committed readings return.
   Disconnect the browser: values remain, visibly **STALE**. Reconnect: only a
   valid snapshot or verified same-head authority-health message restores freshness.

These are actual controller commits; no GIF or generated telemetry is involved.
F2 browser write controls (#11) remain a separate dependency. Commands used in the
automated test also exercise Pause/Resume, blocked feeder, power interruption and
cancellation through the existing authenticated controller.

## Runtime fields and limits

- All three executable machines show their stable runtime ID, committed revision,
  simulated milliseconds, real job ID/state, phase ID, successful work, checkpoint
  time, blocked/failure reason, and last task transition.
- Excavator shows site/cargo/hopper accounts; hopper shows hopper/preheater accounts
  and its scenario feed quantum; preheater shows hopper/preheater accounts. Every
  account retains the real lot ID, integer grams and capacity where applicable.
- Only the preheater has an electrical/thermal model: request ceiling and available
  limit in W, **last recorded applied power, not instantaneous live demand**, spent
  and remaining electrical energy in mJ, calculated temperature in mK/K, target,
  accumulated heat input/loss/residual in mJ, and release readiness.
- A blocked heating step can retain an earlier applied-power record. The label is
  deliberately historical; a power-limit command does not fabricate a new sample.
  The existing lumped model evaluates heat only on successful steps and does not
  model passive cooling while paused/blocked.
- Machines 04–10 explicitly show **Not executable — process model and telemetry
  not implemented**, without zero-valued fictional oxygen, power or temperature.
  LOX machine 11 is excluded from the #4 scene, so no selectable LOX instance or
  readings are invented. Power Distribution's static CAD is not the energy ledger.

`FoundrySnapshot.power` and the new task fields are read-only projections of
scenario limits, the persisted domain and native OI scheduler checkpoints.
`FoundryState.task_transitions` is an optional bounded map (one record per job).
The same OI command transaction records changes of job state/reason/phase with
the actual action, revision and simulated time. Ordinary work steps do not replace
the last transition. Event-history replay and database reopen preserve it. Older
databases remain readable; absent historical transitions say unavailable instead
of guessing. No resource settlement, heating rule or clock policy changes.

## Native integration and engineering provenance

The Vite plugin uses a checked, single-match seam in pinned OI's
`src/components/system-inspector.tsx`. It passes the native selected semantic
binding, resolved status, current target asset, and STEP/MechanicalIR pins to
`FoundryInspection`. Unsupported source changes fail explicitly. The component
uses OI's React instance, native styling and selection; viewport picking and
Locate remain upstream-owned.

`buildInspectionMap` reads the checked-in scene plan, the imported OI manifest,
and all 20 actual source files. Their hashes must match #4's semantic/geometry pins
and STEP asset digest. `GET /api/foundry/inspection-map` returns these verified
identities. Exact allowlisted `GET /api/foundry/artifacts/<machine>/<kind>` routes
serve only these files, enforce F1 local/read-only restrictions, and recheck hashes
at download time (409 on changed bytes). Unknown paths are not file access.
The inspector suppresses runtime readings when its native binding does not match.

**Resolved** certifies identity matching, not physical performance, operational
connections, thermodynamic validation or flight qualification. Existing static
engineering notes remain visible as supplied source descriptions, separate from
the runtime's three executable tasks.

The existing fixed F1/F3 diagnostics are shifted left of the desktop inspector.
Below 1050px the same native inspector is made accessible below the viewport;
diagnostic/material panels enter normal document flow so they cannot cover it.

## Freshness is independent of simulation work

The inspector receives only F1-accepted monotonic snapshots. A transport `open`
event alone does not establish fresh authority. SSE now emits additive
`authority-health` messages containing instance ID and verified head revision:
on connect, recovery from a reader error, and each 15-second heartbeat. These are
not snapshots and cannot advance simulation or trigger task completion. Health is
sent only after a recent successful authority read; failed/stalled reads cannot
renew freshness. Only health matching the browser's accepted instance/revision is
accepted. An error/offline event or 35 seconds without a valid snapshot/health
marks retained values stale. This permits a healthy, idle controller to remain
current without fabricating state revisions.

## Verification

After building the real scene with `bash scripts/run_foundry.sh --build-only`:

```bash
cd vendor/openindustries
node --import tsx --test ../../tests/foundry_inspection.test.ts ../../tests/foundry_stream.test.ts
node --import tsx ../../scripts/verify_foundry_inspection_browser.ts
```

The browser test uses isolated ports 5179/8793 and a fresh SQLite runtime. It checks
native semantic and geometry selection, every machine's availability, task/phase,
ledger values, power/thermal values and units against SQLite, all 20 source links,
Pause/Resume/block/power/cancel, captured stale-frame rejection, offline retention,
same-head health recovery, silent-stream expiry, reload, and mobile inspection.
It also asserts replay equality and an unchanged durable scene head. A browser-only
clock advance tests expiry; it does not advance the controller. Integration tests
cover durable transitions through completion/restart and tampered source pins.

`.generated/issue-14/` holds screenshots, `14-inspection.webm`, and
`14-evidence.json`. The existing CI artifact workflow uploads media/JSON only,
excluding local SQLite files and credentials. No provider keys are required.
