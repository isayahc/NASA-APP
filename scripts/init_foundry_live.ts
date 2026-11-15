/**
 * Create or reopen the *same* local foundry instance for the browser stream.
 * This does not start jobs, tick clocks or reset a persistent scenario.
 *
 * Run from vendor/openindustries with node --import tsx and explicit
 * NASA_FOUNDRY_PASSWORD / NASA_FOUNDRY_DB / NASA_FOUNDRY_INSTANCE_ID.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FoundryDatabase, validateScenario } from "../integrations/openindustries/foundry-runtime.ts";
import { canonicalCommand } from "../vendor/openindustries/server/simulation/commands.mjs";

export async function ensureFoundryInstance(options: {
  database: string;
  password: string;
  instanceId: string;
  scenarioFile: string;
}): Promise<{ instance_id: string; revision: number; simulation_time_ms: number }> {
  /** Authenticate a local principal and create exactly one immutable-scenario factory. */
  if (options.password.length < 12) throw Error("Local secret must be at least 12 characters");
  const content = await readFile(resolve(options.scenarioFile), "utf8");
  const scenario = validateScenario(JSON.parse(content));
  const db = new FoundryDatabase(resolve(options.database));
  try {
    const credentials = { username: "local-founder", password: options.password };
    let token: string;
    try {
      token = (await db.authenticate(credentials)).token;
    } catch {
      // Native OI rejects duplicate usernames; a wrong password does not reset
      // the existing database. No demo account/token is hardcoded.
      token = (await db.authenticate(credentials, true)).token;
    }
    let state;
    try {
      state = db.read(token, options.instanceId);
    } catch (error) {
      if (db.db.prepare("SELECT 1 FROM nasa_foundries WHERE id=?")
        .get(options.instanceId)) throw error;
      state = db.create(token, options.instanceId, scenario);
    }
    const expected = createHash("sha256").update(canonicalCommand(scenario)).digest("hex");
    if (state.model_sha256 !== expected || state.scene_id !== scenario.scene_id)
      throw Error("Existing runtime uses different model or scene; choose another instance ID");
    return {
      instance_id: state.instance_id,
      revision: state.revision,
      simulation_time_ms: state.simulation_time_ms,
    };
  } finally { db.close(); }
}

if (process.argv[1] &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const password = process.env.NASA_FOUNDRY_PASSWORD ?? "";
  const database = process.env.NASA_FOUNDRY_DB ??
    fileURLToPath(new URL("../.generated/foundry-live.sqlite", import.meta.url));
  const instanceId = process.env.NASA_FOUNDRY_INSTANCE_ID ?? "foundry-live-01";
  const scenarioFile = fileURLToPath(new URL("../scenarios/lunar-south-pole/first-transfer.json", import.meta.url));
  ensureFoundryInstance({ database, password, instanceId, scenarioFile })
    .then((state) => console.log(JSON.stringify({
      status: "initialized", ...state, note: "No jobs or simulation ticks executed.",
    })))
    .catch((error) => { console.error("LIVE_FACTORY_SETUP_FAILED", error); process.exitCode = 1; });
}
