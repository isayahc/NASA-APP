/** Offline spatial integration invariants; no CAD/LLM dependencies needed. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { checkPlan, guardedInputPath, makeLayout } from "../scripts/build_lunar_scene.mjs";

const plan = JSON.parse(readFileSync(resolve("scenes/lunar-foundry.plan.json"), "utf8"));

function geometry(machines) {
  return machines.map((machine, i) => ({
    machine,
    asset: {
      id: "actual-cad-" + String(machine.number),
      source: { digest: "a".repeat(64) },
      dimensions: [1.5 + i * 0.1, 1 + i * 0.05, 1.25 + i * 0.07],
    },
    position: null,
    cadHash: "b".repeat(64),
    irHash: "c".repeat(64),
  }));
}

test("the planned plant has unique real CAD references and no Phase-2 LOX station", () => {
  const { machines, links } = checkPlan(plan);
  assert.equal(machines.length, 10);
  assert.equal(links.length, 14);
  assert(machines.every((m) => m.cad.endsWith(".step") && m.executable === false));
  assert(!machines.some((m) => m.number === 11));
});

test("layout fits a legal room, has distinct envelopes and grounded machine ports", () => {
  const { machines, links } = checkPlan(plan);
  const { room, graph, items } = makeLayout(plan, geometry(machines), links, false);
  assert.equal(items.length, 10);
  assert.equal(graph.links.length, 14);
  assert(room.every((n) => n >= 1 && n <= 100));
  assert(graph.stations.every((s) => Object.keys(s.ports).length > 0));
  assert(graph.stations.every((s) => s.status.executable === false));
  assert(graph.links.every((link) => link.operational === false));
  assert(graph.links.filter((link) => link.kind === "regolith").every((link) => link.distance_m < 1));
});

test("first four keep valid primary stream and omit unrelated support stations", () => {
  const { machines, links } = checkPlan(plan, true);
  assert.deepEqual(machines.map((m) => m.number), [1, 2, 3, 4]);
  assert.equal(links.length, 3);
  const { graph } = makeLayout(plan, geometry(machines), links, true);
  assert.equal(graph.machine_count, 4);
  assert.equal(graph.links.length, 3);
});

test("untrusted source paths and misleading execution state are rejected", () => {
  assert.throws(() => guardedInputPath(resolve("."), "../invalid.step"), /outside NASA-APP/);
  assert.throws(() => guardedInputPath(resolve("."), "/tmp/invalid.step"), /invalid source path/);
  const changed = structuredClone(plan);
  changed.machines[0].executable = true;
  assert.throws(() => checkPlan(changed), /may not claim executable/);
  const changedLink = structuredClone(plan);
  changedLink.links[0].to_port = "wrong";
  assert.throws(() => checkPlan(changedLink), /Invalid declared connection/);
});
