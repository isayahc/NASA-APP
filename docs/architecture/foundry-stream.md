# F1 — Authoritative runtime SSE into the native OpenIndustries workbench

**Scope:** Read-only browser transport for the already implemented **#5 controller** and real **#4 CAD scene**. The simulator does **not** advance on its own. The live launcher also includes the [F3 joint adapter](foundry-kinematics.md); browser operation controls and full machine inspection remain separate work.

## Launch on WSL2 / Linux

From the NASA-APP checkout (Node.js 22.16+, npm, Git required):

```bash
bash scripts/run_foundry_live.sh
```

This runs the normal STEP-backed `run_foundry.sh --build-only` pipeline, creates or reopens a real authenticated foundry instance in `.generated/foundry-live.sqlite`, launches the existing OI API on `127.0.0.1:8787`, and runs the **existing OI Vite/React/Three workbench** on `127.0.0.1:5173` with the optional local SSE plugin. It prints the persistent localSceneId URL. The browser's small read-only status panel should show the actual revision, simulation time, regolith inventories, preheater temperature, energy and job states. All are labeled simulated.

The first launch generates a random local OI password in `.generated/foundry-local-password` with mode 0600 (unless `NASA_FOUNDRY_PASSWORD` is supplied). The whole `.generated/` directory is excluded from Git. **Never commit local passwords, SQLite files or tokens.**

F1 does **not** start production or cause ticks. To confirm the SSE connection from a second WSL2 terminal, explicitly run one or more controller steps using the *same* existing state:

```bash
export NASA_FOUNDRY_PASSWORD="$(cat .generated/foundry-local-password)"
export NASA_FOUNDRY_DB="$(pwd)/.generated/foundry-live.sqlite"
export NASA_FOUNDRY_INSTANCE_ID=foundry-live-01
(cd vendor/openindustries && node --import tsx ../../scripts/advance_foundry_live.ts --ticks 1)
```

The first invocation starts the legitimate OI jobs, then steps once. The open browser should receive the new committed revision without reloading or changing the CAD scene revision. A browser reload recovers the current head. Subsequent invocations continue that same persistent state; they do not reset inventories. If you supplied your own password, use that exact value in the second terminal instead of the file.

## Transport contract

The Vite plugin at `integrations/openindustries/vite.foundry.config.ts` extends OI's *own* Vite configuration, preserving the real editor and renderer. It mounts **read-only, same-origin** routes:

| Route | Behavior |
| --- | --- |
| `GET /api/foundry/config` | Declares protocol, OI local scene identity, and read-only status |
| `GET /api/foundry/snapshot` | Latest committed validated controller projection |
| `GET /api/foundry/events` | Server-Sent Events with `event: snapshot`, revision-scoped `id`, auto reconnection, and heartbeats |
| `GET /api/foundry/kinematics` | F3 verified CAD identities, source hashes and joint policy |
| `GET /api/foundry/material-map` | F4 declared machine port anchors for ledger annotations |

No browser-facing `POST`, `start`, `step`, resource mutation or power-command endpoint exists in F1. A separate CLI is used to exercise the existing controller. The SSE process reads SQLite under its OI-native authorization and shares **no credentials** with the browser.

Each snapshot event uses `protocol: nasa.foundry.snapshot.v1`, stable runtime instance ID, source scene key `lunar-foundry-mvp`, monotonically increasing controller revision and simulated time, and the actual committed `FoundrySnapshot`. The stream ID is `<runtime-instance>:<revision>`. If a connection drops, EventSource reconnects automatically using Last-Event-ID; the server publishes only a newer committed head. This is **latest-state resynchronization**, not a promise to replay every intermediate event.

The browser consumer at `foundry-browser-stream.mjs` rejects unknown scenes, mismatched instances, duplicate/out-of-order revisions, clock regressions, and failed mass/energy conservation. Accepted frames are forwarded to future integrations using:

```javascript
window.addEventListener("nasa-foundry:snapshot", (event) => {
  const committedFrame = event.detail; // Read-only transport, not a machine command.
});
```

The small diagnostic panel uses `#nasa-foundry-transport` and shows `data-runtime-revision` and `data-stream-status` for automated verification. F1 does not play GIFs or calculate machine poses. When disconnected it reports offline/reconnecting and **never fabricates simulation progress**.

## Security and operational limits

- **Development-only, single local operator, loopback only.** Do not publicly expose the Vite dev server or this SSE service.
- Host/Origin/fetch-site checks reject cross-site reads. No CORS wildcard, URL token, browser API key or provider secret.
- The server retains a short-lived native OI login token only in the server process and never writes it into a browser response. Existing auth has an eight-hour session lifetime; restart the local workbench after expiry to renew.
- SSE polling observes **controller revisions approximately every 200 ms**. It does *not* drive physics time or use the local CAD scene's two-second revision sync. Native OI retains spatial/scene authority.
- Start F1 against the same named runtime and versioned scene plan. A changed scenario/instance fails closed rather than silently resetting the foundry.
- F1's small diagnostic is an integration aid, not a replacement for full machine selection or performance instrumentation.

## CI and acceptance

```bash
(cd vendor/openindustries && node --import tsx --test ../../tests/foundry_stream.test.ts)
```

CI also runs the existing #5 controller tests, builds the real ten-machine STEP scene, launches the genuine OI browser in Chromium, observes SSE updates generated by controller commands from Node, and reloads the scene. It tests reconnect/Last-Event-ID, monotonic filtering, wrong-instance and cross-origin rejection, and strict read-only behavior. The workflow uploads a screenshot and transport evidence.

**Next:** F2 controller controls and full inspection. F3 consumes the committed stream for joint poses, and [F4](foundry-material.md) shows lot balances and settled ledger postings. No MRE yield model or oxygen production is claimed by F1.
