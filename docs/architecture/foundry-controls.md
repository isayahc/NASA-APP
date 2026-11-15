# F2 — Authoritative local operator controls (#11)

The live launcher now mounts controls **inside the native OpenIndustries inspector**.
All writes use a separate local HTTP command bridge. F1's snapshot/config/events
endpoints remain read-only, and F1 snapshots are the only telemetry read-back.

## Operator behavior

| Control | Authoritative effect |
| --- | --- |
| Start | Queue the three real OI jobs exactly once; no elapsed simulation time and no automatic clock yet |
| Step | While the plant clock is paused, advance exactly one 1,000 ms scheduler quantum |
| Resume | Persist automatic-clock mode and start the server-owned timer |
| Pause | Persist paused-clock mode and cancel automatic scheduling; manual Step is still available |
| Speed | Persist one of 0.25×, 1×, 2×, 4×; change the interval between server-authorized quanta |
| Reset — new run | Archive further writes to this run, create a fresh named run and its initial history atomically, and reload into that new instance |

The plant-clock pause is separate from the existing per-job `pause`/`resume`
commands. A task can retain its `running` checkpoint while the **plant clock is
paused/manual**; the inspector shows both. Explicit manual Step is allowed work,
not an automatic tick leaking through Pause. Existing per-job pauses still freeze
that job's work when the schedule advances. Operator commands other than Step do
not advance simulated time.

**Operating constraints** exposes real feeder block/unblock and heater power
cut/restore commands. They change the same domain constraints already used by the
controller, producing actual waiting reasons rather than staged failure telemetry.

Controls disable invalid actions and stale/disconnected submissions, show pending
state and rejection messages, and label the current run ID/revision/time. A
concurrent tick can cause a legitimate revision conflict; the rejected operation
has no effect and the operator can retry after the next snapshot. A command response
never updates material, poses or inspector metrics directly.

## Command and clock contract

The bridge accepts the native OI envelope:

```json
{"command_id":"unique-id","instance_id":"foundry-live-01","expected_revision":1,"action":"start","payload":{}}
```

`FoundryDatabase.execute` still uses the pinned OI `executeTransactionalCommand`,
SQLite transaction, revision check, command receipts and hash-chained event history.
Actions are allowlisted; payloads are validated by the domain. Same ID/same request
returns the original receipt without another scheduling effect; changed payloads
with a reused ID and stale revisions return 409. Browser requests cannot invoke
the internal `clock-step` action.

The clock uses `tick_ms / speed` wall milliseconds, then issues **one** native
`clock-step` with the current expected revision. Slow machines run slower; no
wall-time debt or catch-up burst is paid on reconnect/resume. Rendering cadence is
independent. Changing speed or a running control command starts a new interval;
unpaid partial wall intervals are discarded. Terminal jobs stop scheduling.

The resumed operator must have an authenticated SSE connection and renew a
one-second HTTP lease. The last stream for that operator closing pauses immediately;
expired/missing authorization or a lease older than 2.5 seconds prevents the next
tick. Read-only viewers do not start a clock. Multiple tabs sharing the same local
operator cookie can keep it connected; one disappearing tab does not defeat another
connected tab. Server startup/shutdown pauses persisted automatic mode instead of
silently restarting work. Use one live workbench/server process per database.

## Reset, history and compatibility

Reset is a native command on the current run. Its transaction stores an explicit
`successor_id`, stops its clock, inserts a fresh scenario-bound run at revision 1 /
time 0, initializes native event history, and saves the reset receipt. A failure in
any operation rolls the entire transaction back. IDs are deterministic hashes of
the old instance and reset command ID, prefixed `run-`; no prior run is deleted.
Duplicate reset receipts cannot create further runs or stop a later run's clock.

The configured root ID resolves through its durable successor links on restart.
Other tabs receive an SSE `run-changed` notification and reload; the new config pins
the new instance before the monotonic reducer starts. An old-run frame cannot reset
the new run's poses or inventory. Old runs are still readable/replayable, and new
writes to archived runs are rejected. The CLI follows the same lineage and requires
the automatic clock to be paused before issuing manual steps.

Persisted `controls` and `successor_id` fields are additive/optional on older state.
An older run defaults to paused, 1×. Material/thermal rules, canonical integer
units, and fixed simulation quantum are unchanged.

## Local authorization

- `GET /api/foundry/control-session` checks loopback Host/same-origin fetch context
  and the server's native OI login, then issues an opaque process-local capability
  in an **HttpOnly, SameSite=Strict** cookie. It returns no native token/password.
- `POST /api/foundry/commands` and `/api/foundry/control-lease` require that live
  capability, exact same-origin `Origin`, and `X-Foundry-Command: 1`. Commands require
  JSON and the native bounded envelope. No CORS allowance is added.
- The browser acts as the configured **single local operator**, not as a separately
  provisioned remote account. Capability bootstrap assumes trusted local access.
  HTTP loopback cookies intentionally are not production HTTPS authentication.
- The password/native OI token stays server-side; no secret is embedded in browser
  bundles, URLs, snapshots or evidence. Expired native authorization stops writes.

## Verification

From `vendor/openindustries` after the scene build:

```bash
node --import tsx --test ../../tests/foundry_controls.test.ts
node --import tsx ../../scripts/verify_foundry_slice_browser.ts
```

HTTP tests cover credentials/origin/header checks, invalid speeds/actions, revisions,
duplicate receipts, exact quantum, atomic reset failure and history/reopen,
lease expiry, startup pause, and disconnection. The complete [F6 browser test](foundry-slice-verification.md)
clicks real controls, exercises all four speeds, verifies committed read-back and
conservation, and captures desktop/mobile evidence.
