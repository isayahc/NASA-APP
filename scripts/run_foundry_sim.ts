/**
 * Headless source-backed NASA-APP manufacturing smoke, using the OI runtime.
 *
 * Requires a pinned checkout of Mapped-Assembly/OpenIndustries and its
 * dependencies in vendor/openindustries. No renderer or LLM calls here.
 *
 * Usage:
 *   NASA_FOUNDRY_PASSWORD=<private-local-password> \
 *   node --import tsx scripts/run_foundry_sim.ts --ticks 86
 */
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FoundryDatabase, type Scenario, type FoundrySnapshot } from "../integrations/openindustries/foundry-runtime.ts";

interface Options {
  database: string;
  scenario: string;
  output: string;
  ticks: number;
  cutPowerAt: number | null;
  restorePowerAt: number | null;
}

function options(args: string[]): Options {
  /** Parse explicit trusted local simulation options. */
  const field = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : String(args[i + 1]);
  };
  const integer = (v: string, label: string): number => {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid " + label);
    return n;
  };
  const n = (flag: string): number | null => args.includes(flag)
    ? integer(field(flag, ""), flag) : null;
  return {
    database: resolve(field("--db", fileURLToPath(new URL("../.generated/nasa-foundry.sqlite", import.meta.url)))),
    scenario: resolve(field("--scenario", fileURLToPath(new URL("../scenarios/lunar-south-pole/first-transfer.json", import.meta.url)))),
    output: resolve(field("--output", fileURLToPath(new URL("../.generated/first-transfer-evidence.json", import.meta.url)))),
    ticks: integer(field("--ticks", "86"), "ticks"),
    cutPowerAt: n("--cut-power-at"),
    restorePowerAt: n("--restore-power-at"),
  };
}

async function openOperator(db: FoundryDatabase): Promise<string> {
  /** Authenticate one local operator without saving a credential in the repo. */
  const secret = process.env.NASA_FOUNDRY_PASSWORD;
  if (!secret || secret.length < 12) {
    throw Error("Set NASA_FOUNDRY_PASSWORD (at least 12 characters); no default is committed");
  }
  const identity = { username: "local-founder", password: secret };
  try {
    return (await db.authenticate(identity)).token;
  } catch {
    return (await db.authenticate(identity, true)).token;
  }
}

async function main(): Promise<void> {
  /** Execute a complete deterministic task run with a durable SQLite evidence trail. */
  const opt = options(process.argv.slice(2));
  const scenario = JSON.parse(await readFile(opt.scenario, "utf8")) as Scenario;
  await mkdir(dirname(opt.database), { recursive: true });
  const db = new FoundryDatabase(opt.database);
  try {
    const token = await openOperator(db);
    const id = "foundry-" + randomUUID().replaceAll("-", "");
    let state = db.create(token, id, scenario);
    const snapshots: FoundrySnapshot[] = [state];
    const send = (action: string, payload: Record<string, unknown> = {}): FoundrySnapshot => {
      const result = db.execute(token, {
        command_id: randomUUID().replaceAll("-", ""),
        instance_id: id,
        expected_revision: state.revision,
        action,
        payload,
      });
      state = result.snapshot;
      return state;
    };
    snapshots.push(send("start"));
    for (let i = 1; i <= opt.ticks; i++) {
      if (i === opt.cutPowerAt) snapshots.push(send("set-power", { limit_w: 0 }));
      if (i === opt.restorePowerAt)
        snapshots.push(send("set-power", { limit_w: scenario.constraints.power_limit_w }));
      snapshots.push(send("step"));
    }
    const replay = db.replay(token, id);
    if (JSON.stringify(replay) !== JSON.stringify(state)) throw Error("History replay mismatched head");
    if (!state.mass_conserved || !state.energy_conserved) throw Error("Resource conservation failed");
    const summary = {
      format: "nasa.first-transfer-evidence",
      version: 1,
      instance_id: id,
      scenario_id: scenario.scene_id,
      source: opt.scenario,
      provenance: "simulated-and-modeled-not-measured",
      model_sha256: state.model_sha256,
      tick_count: opt.ticks,
      final_snapshot: state,
      timeline: snapshots.map((value) => ({
        time_ms: value.simulation_time_ms,
        revision: value.revision,
        inventory_g: value.inventory_g,
        energy_mJ: value.energy_mJ,
        thermal: value.thermal,
        jobs: value.machines.map((machine) => ({
          id: machine.id, status: machine.status, reason: machine.reason,
        })),
      })),
      limitations: [
        "No material-contact/dust physics or actual robotic locomotion",
        "No MRE/electrolysis, oxygen or mineral transformation",
        "Thermal model uses lumped capacity and bounded, assumed UA heat loss",
        "No browser motion or 3D pose streaming; #6 owns that",
      ],
    };
    await mkdir(dirname(opt.output), { recursive: true });
    await writeFile(opt.output, JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify({
      status: "pass",
      instance_id: id,
      simulation_time_ms: state.simulation_time_ms,
      inventory_g: state.inventory_g,
      energy_mJ: state.energy_mJ,
      thermal: state.thermal,
      jobs: state.machines,
      mass_conserved: state.mass_conserved,
      energy_conserved: state.energy_conserved,
      evidence: opt.output,
    }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error("FOUNDRY_SIM_FAILED", error);
  process.exitCode = 1;
});
