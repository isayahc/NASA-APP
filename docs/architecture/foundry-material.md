# F4 — Finite regolith lot in the native OI view (#13)

The live launcher (`bash scripts/run_foundry_live.sh`) now shows **committed
material balances** beside the CAD machines. Advance the existing controller with
`scripts/advance_foundry_live.ts` as described in [F1](foundry-stream.md).
F2 browser controls (#11) now use a [separate authenticated bridge](foundry-controls.md);
the material view adds no simulation clock or command endpoint. It consumes the same F1 snapshots and uses
the F3 native viewer seam.

## One lot, four authoritative accounts

`FoundrySnapshot.material` is an additive, read-only projection from the existing
OI resource ledger and immutable scenario. The ledger, its transitions and replay
format are unchanged. Fields include:

- The original scenario lot ID, provenance, composition assumption (including
  unresolved remainder), total initial mass, and current ledger sequence.
- `site`, `transit`, `hopper`, `preheater` accounts: integer grams for that lot,
  actual ledger account kind, owner ID (currently null/unassigned), and capacity.
- The last ten retained **actual regolith balance entries**: context/posting ID,
  ledger sequence, simulated timestamp, task ID and signed gram postings.
- Scenario-specific feed quantum (`delivery_g / feed_ticks`), not a hardcoded rate.

The UI cross-checks the account quantities against `inventory_g`, validates finite
capacities and total conservation, checks lot identity and monotonic sequence, and
requires equal debit/credit pairs with known task/routes. A rejected frame retains
the last valid quantities with an explicit error. Grams are canonical; kilograms
are a display conversion to three decimals. The composition is explicitly an
assumption and **not an oxygen yield or measured lunar sample**.

| Visible state | Source of quantity | Representation |
| --- | --- | --- |
| Site stock | `site` balance | Numeric g/kg in ledger panel; no invented terrain pile/anchor |
| Excavator cargo | `transit` balance | Numeric g/kg and mass-capacity meter; outlet-anchored label |
| Hopper | `hopper` balance | Numeric g/kg and mass-capacity meter; inlet-anchored label |
| Feeder/conveyor | Settled `hopper → preheater` postings | Pass-through status and g/settled step; **no separate inventory account** |
| Preheater WIP | `preheater` balance | Numeric g/kg and mass-capacity meter; inlet-anchored label |

Meters represent **mass capacity**, not physical granular depth or packed volume.
Site storage has no capacity ceiling in the ledger, but its source stock is finite;
the panel never implies unbounded extraction. There is no fifth stock balance on
the feeder, no duplicate cargo mass, and no displayed oxygen inventory.

## Exact transfer behavior

For the default 10,000 g site stock and 1,000 g delivery:

1. Pickup settles 1,000 g `site → transit`. The hopper remains at 0 g through
   the first three successful delivery steps.
2. The fourth successful delivery step settles 1,000 g `transit → hopper`.
3. Each of five successful feed steps settles 200 g `hopper → preheater`.
4. Heating changes temperature/energy, not mass. The final material accounts are
   9,000 g site, 0 g cargo, 0 g hopper, 1,000 g preheater.

An initially full hopper prevents delivery credit; cargo remains held. An empty
site prevents pickup. Paused/blocked work creates no transfer. Cancelling a delivery
returns held cargo to site using the **actual cancellation posting**, without
silently hiding or destroying it. Cancelling after a transfer does not reverse
that posting or reset balances. Ownership labels show actual ledger assignment,
not an invented per-machine principal.

## Port anchoring and rendering

`foundry-material-map.mjs` reuses #4's `checkPlan` and `makeLayout` with the actual
imported assets. It verifies stored placements and returns the two declared
regolith links plus the first three stations' exact local port coordinates.
`GET /api/foundry/material-map` is a local, same-origin, read-only endpoint.

The pinned OI view adapter calls `renderFoundryMaterial` after native world pose and
camera updates. It projects port coordinates through the actual OI group world
matrix and camera into SVG annotations over that canvas. It retains OI's renderer,
mesh identities, picking and camera. Offscreen/hidden anchors are culled. Missing
machine/asset/port identities fail explicitly. Coordinates are Y-up meters from
#4, **declared engineering anchors, not physically verified plumbing**. Cargo is
annotated at the excavator outlet, not rendered as an assumed drum fill volume.

Only settled postings can produce a dotted route annotation. Each line explicitly
reads `N g settled @Ts (history)` and corresponds to the latest retained posting
for that route. It is **not live flow**: there are no moving arrows, particles,
GIFs, volume meshes or interpolation. Historical receipts may remain visible while
paused/blocked; the panel shows the actual task status. No line exists before a
posting. Site pickup/return receipts appear in the panel because #4 defines no
site port. The bounded ledger history may roll out; absence from that tail is
not evidence that a transfer never happened.

Rendering never changes a ledger, job, quantity or scene revision. Offline keeps
the last committed mass and marks it stale. Reconnect/refresh replaces the entire
view with the authoritative snapshot; skipped SSE revisions are not replayed as
fabricated in-flight mass. The same lot may occupy multiple accounts at once.

## Verification and evidence

After installing the pinned OI dependency and building the real scene:

```bash
(cd vendor/openindustries && node --import tsx --test ../../tests/foundry_material.test.ts)
(cd vendor/openindustries && node --import tsx ../../scripts/verify_foundry_material_browser.ts)
```

The unit/integration tests use real SQLite, resource balances, commands and replay.
They compare the projection to raw account/lot balances and exact posting credits
and debits; reject corrupted quantities, capacity and lot IDs; and compare port
anchors with #4's generated connection graph.

The Chromium test uses isolated ports 5177/8791, fresh SQLite runs and the actual
ten-machine OI scene. It checks every displayed integer balance and mass meter
against SQLite, verifies no early hopper credit, all five 200 g steps, the port
annotations, full/empty/paused/blocked/cancelled behavior, reconnect/refresh, a
390px viewport, and an unchanged durable scene head. The normal-run video and
screenshots/JSON are in `.generated/issue-13/`; CI uploads only media and evidence,
not SQLite files or credentials.

No granular physics, new renderer, reactor chemistry, oxygen production or
autonomous control is implemented or implied by this material presentation.
