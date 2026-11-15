/**
 * Development-only controller CLI to generate genuine new snapshots for F1.
 * Browser SSE remains read-only. F2 will add validated browser controls.
 *
 * Usage (from vendor/openindustries):
 *   node --import tsx ../../scripts/advance_foundry_live.ts --ticks 1
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FoundryDatabase } from "../integrations/openindustries/foundry-runtime.ts";

async function main(): Promise<void> {
  /** Issue native OI transaction commands against a named existing instance. */
  const password = process.env.NASA_FOUNDRY_PASSWORD ?? "";
  if (password.length < 12) throw Error("NASA_FOUNDRY_PASSWORD is required");
  const database = resolve(process.env.NASA_FOUNDRY_DB ??
    fileURLToPath(new URL("../.generated/foundry-live.sqlite", import.meta.url)));
  const instanceId = process.env.NASA_FOUNDRY_INSTANCE_ID ?? "foundry-live-01";
  const tickFlag = process.argv.indexOf("--ticks");
  const ticks = tickFlag < 0 ? 1 : Number(process.argv[tickFlag + 1]);
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 200)
    throw Error("Choose between 0 and 200 explicit simulation ticks");
  const db = new FoundryDatabase(database);
  try {
    const token = (await db.authenticate({
      username: "local-founder", password,
    })).token;
    let snapshot = db.read(token, instanceId);
    const execute = (action: string) => {
      snapshot = db.execute(token, {
        command_id: randomUUID(), instance_id: instanceId,
        expected_revision: snapshot.revision, action, payload: {},
      }).snapshot;
    };
    if (snapshot.machines.length === 0) throw Error("No controller jobs available");
    const initial = db.load(instanceId).schedule.jobs.length === 0;
    if (initial) execute("start");
    for (let n = 0; n < ticks; n++) execute("step");
    console.log(JSON.stringify({
      instance_id: snapshot.instance_id,
      revision: snapshot.revision,
      simulation_time_ms: snapshot.simulation_time_ms,
      machines: snapshot.machines,
      inventory_g: snapshot.inventory_g,
      energy_mJ: snapshot.energy_mJ,
      provenance: snapshot.provenance,
      note: "Real controller executed; SSE subscriber will observe committed revision.",
    }, null, 2));
  } finally { db.close(); }
}

main().catch((error) => {
  console.error("F1_DEVELOPMENT_STEP_FAILED", error);
  process.exitCode = 1;
});
