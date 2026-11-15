/** Real OpenIndustries job/ledger/SQLite integration tests; no fake physics. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FoundryDatabase, JOBS, type Scenario, type FoundrySnapshot } from "../integrations/openindustries/foundry-runtime.ts";

const scenario = JSON.parse(readFileSync(resolve("scenarios/lunar-south-pole/first-transfer.json"), "utf8")) as Scenario;
const credentials = { username: "operator", password: "integration-test-password" };

async function setup(s: Scenario = scenario) {
  /** Make an isolated, real file-backed SQLite authority. */
  const dir = mkdtempSync(join(tmpdir(), "nasa-foundry-"));
  const db = new FoundryDatabase(join(dir, "foundry.sqlite"));
  const token = (await db.authenticate(credentials, true)).token;
  let state = db.create(token, "first-transfer-01", s);
  let counter = 0;
  const issue = (action: string, payload: Record<string, unknown> = {}) => {
    /** Apply a valid OI transactional command and return its persisted snapshot. */
    state = db.execute(token, {
      command_id: "command-" + ++counter,
      instance_id: "first-transfer-01", expected_revision: state.revision, action, payload,
    }).snapshot;
    return state;
  };
  const step = (ticks: number) => {
    /** Advance physical time through OI's one-second job scheduler. */
    for (let i = 0; i < ticks; i++) issue("step");
    return state;
  };
  const close = () => {
    /** Close database handles and clean the isolated test directory. */
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { db, dir, token, get state() { return state; }, issue, step, close };
}

function job(state: FoundrySnapshot, id: string) {
  /** Get one recorded task by stable ID. */
  const item = state.machines.find((j) => j.id === id);
  assert(item, "Missing task " + id);
  return item;
}

function balanced(state: FoundrySnapshot, s: Scenario) {
  /** Ensure both OI resource units remain conserved after every tested action. */
  assert.equal(state.mass_conserved, true);
  assert.equal(state.energy_conserved, true);
  assert.equal(Object.values(state.inventory_g).reduce((a, b) => a + b, 0),
    s.opening.source_regolith_g + (s.opening.hopper_regolith_g ?? 0));
  assert.equal(state.energy_mJ.available + state.energy_mJ.spent, s.opening.available_energy_mJ);
  assert(state.observations.every((o) => o.origin === "simulated" && o.validity === "modeled"));
}

test("source -> cargo -> hopper -> feeder -> preheater executes and consumes real energy", async () => {
  const h = await setup();
  try {
    h.issue("start");
    h.step(1);
    assert.equal(h.state.inventory_g.transit, 1000);
    assert.equal(h.state.inventory_g.hopper, 0, "unfinished delivery must not credit hopper");
    h.step(2);
    assert.equal(h.state.inventory_g.hopper, 0);
    h.step(1);
    assert.equal(h.state.inventory_g.transit, 0);
    assert.equal(h.state.inventory_g.hopper, 1000);
    assert.equal(job(h.state, JOBS.delivery).status, "completed");
    h.step(1);
    assert.equal(h.state.inventory_g.preheater, 200);
    h.step(4);
    assert.equal(h.state.inventory_g.preheater, 1000);
    assert.equal(job(h.state, JOBS.feeding).status, "completed");
    const initialT = h.state.thermal.temperature_mK;
    h.step(1);
    assert(h.state.thermal.temperature_mK > initialT);
    assert(h.state.energy_mJ.spent > 0);
    h.step(scenario.constraints.heating_ticks - 1);
    assert.equal(job(h.state, JOBS.heating).status, "completed");
    assert.equal(h.state.thermal.output_ready, true);
    assert(h.state.thermal.temperature_mK >= scenario.constraints.target_temperature_mK);
    assert.equal(h.state.energy_mJ.spent, h.state.thermal.input_energy_mJ);
    assert(h.state.thermal.lost_energy_mJ > 0);
    balanced(h.state, scenario);
    assert.deepEqual(h.db.replay(h.token, "first-transfer-01"), h.state);
  } finally { h.close(); }
});

test("power outage pauses modeled heat and resuming power resumes physically paid work", async () => {
  const h = await setup();
  try {
    h.issue("start");
    h.step(9);
    const initialT = h.state.thermal.temperature_mK;
    h.issue("set-power", { limit_w: 0 });
    h.step(5);
    assert.equal(job(h.state, JOBS.heating).status, "waiting-for-resource");
    assert.match(job(h.state, JOBS.heating).reason ?? "", /insufficient-power/);
    assert.equal(h.state.thermal.temperature_mK, initialT);
    assert.equal(h.state.energy_mJ.spent, 0);
    h.issue("set-power", { limit_w: 900 });
    h.step(scenario.constraints.heating_ticks);
    assert.equal(job(h.state, JOBS.heating).status, "completed");
    balanced(h.state, scenario);
  } finally { h.close(); }
});

test("duplicate command receipts, pause and durable SQLite history survive restart", async () => {
  const h = await setup();
  const file = join(h.dir, "foundry.sqlite");
  try {
    h.issue("start");
    h.step(1);
    const raw = { command_id: "pause-fixed-id", instance_id: "first-transfer-01",
      expected_revision: h.state.revision, action: "pause",
      payload: { job_id: JOBS.delivery } };
    const first = h.db.execute(h.token, raw);
    assert.deepEqual(h.db.execute(h.token, raw), first);
    assert.throws(() => h.db.execute(h.token, {
      ...raw, payload: { job_id: JOBS.heating },
    }), /COMMAND_ID_REUSED/);
    let state = first.snapshot;
    for (let i = 0; i < 4; i++) {
      state = h.db.execute(h.token, {
        command_id: "step-paused-" + i,
        instance_id: "first-transfer-01", expected_revision: state.revision,
        action: "step", payload: {},
      }).snapshot;
      assert.equal(state.inventory_g.hopper, 0);
      assert.equal(state.inventory_g.transit, 1000);
    }
    h.db.close();
    const restored = new FoundryDatabase(file);
    try {
      const token = (await restored.authenticate(credentials)).token;
      assert.deepEqual(restored.replay(token, "first-transfer-01"), state);
      assert.deepEqual(restored.execute(token, raw), first);
      const resumed = restored.execute(token, {
        command_id: "resume-fixed-id", instance_id: "first-transfer-01",
        expected_revision: state.revision, action: "resume",
        payload: { job_id: JOBS.delivery },
      }).snapshot;
      assert.equal(job(resumed, JOBS.delivery).status, "running");
      balanced(resumed, scenario);
    } finally { restored.close(); }
  } finally { rmSync(h.dir, { recursive: true, force: true }); }
});

test("empty source, full hopper and a blocked feeder do not conjure regolith", async () => {
  const empty = structuredClone(scenario);
  empty.opening.source_regolith_g = 0;
  const a = await setup(empty);
  try {
    a.issue("start"); a.step(3);
    assert.equal(job(a.state, JOBS.delivery).status, "waiting-for-resource");
    balanced(a.state, empty);
  } finally { a.close(); }

  const full = structuredClone(scenario);
  full.opening.hopper_regolith_g = full.constraints.hopper_capacity_g;
  const b = await setup(full);
  try {
    b.issue("start"); b.step(4);
    assert.equal(job(b.state, JOBS.delivery).reason, "hopper-full");
    assert.equal(b.state.inventory_g.transit, 1000);
    b.issue("cancel", { job_id: JOBS.delivery });
    assert.equal(b.state.inventory_g.transit, 0);
    assert.equal(job(b.state, JOBS.delivery).status, "cancelled");
    balanced(b.state, full);
  } finally { b.close(); }

  const c = await setup();
  try {
    c.issue("start"); c.step(4);
    c.issue("set-feeder-blocked", { blocked: true }); c.step(3);
    assert.equal(job(c.state, JOBS.feeding).reason, "feeder-blocked");
    assert.equal(c.state.inventory_g.preheater, 0);
    c.issue("set-feeder-blocked", { blocked: false }); c.step(1);
    assert.equal(c.state.inventory_g.preheater, 200);
    balanced(c.state, scenario);
  } finally { c.close(); }
});

test("rejected commands cannot create unauthorized mass, false wiring or unlimited watts", async () => {
  const h = await setup();
  try {
    assert.throws(() => h.issue("set-power", { limit_w: -1 }), /limit W/);
    assert.throws(() => h.issue("set-power", { limit_w: 100000 }), /power limit/);
    assert.throws(() => h.issue("start", { fabricate_oxygen: true }), /empty payload/);
    assert.equal(h.state.inventory_g.site, scenario.opening.source_regolith_g);
    assert.equal(h.state.energy_mJ.spent, 0);
    balanced(h.state, scenario);
  } finally { h.close(); }
});
