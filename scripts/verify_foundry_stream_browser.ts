/**
 * Real browser integration: native OI scene + local SSE + SQLite controller.
 *
 * This does not create a second renderer or invent movement. F1 only streams
 * immutable committed status to the existing browser and tests refresh.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { FoundryDatabase } from "../integrations/openindustries/foundry-runtime.ts";
import { ensureFoundryInstance } from "./init_foundry_live.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OI_ROOT = resolve(ROOT, "vendor/openindustries");
const DATABASE = resolve(ROOT, ".generated/f1-browser.sqlite");
const STORE = resolve(ROOT, ".generated/f1-browser-scene-store");
const PASSWORD = "ci-only-local-transport-test-secret";
const INSTANCE = "f1-browser-instance";
const SCENARIO = resolve(ROOT, "scenarios/lunar-south-pole/first-transfer.json");

async function main(): Promise<void> {
  /** Import real native OI modules, load its existing scene and validate F1 SSE. */
  const session = JSON.parse(await readFile(
    resolve(ROOT, ".generated/lunar-foundry.session.json"), "utf8",
  )) as { scene_id: string };
  assert.match(session.scene_id, /^[0-9a-f-]{36}$/i);
  await mkdir(resolve(ROOT, ".generated"), { recursive: true });
  await ensureFoundryInstance({
    database: DATABASE, password: PASSWORD, instanceId: INSTANCE,
    scenarioFile: SCENARIO,
  });
  const env = {
    ...process.env,
    NASA_FOUNDRY_DB: DATABASE,
    NASA_FOUNDRY_PASSWORD: PASSWORD,
    NASA_FOUNDRY_INSTANCE_ID: INSTANCE,
    NASA_FOUNDRY_OI_SCENE_ID: session.scene_id,
    OI_ROOT,
    OI_SCENE_BACKEND: "local",
    OI_SCENE_TOOLS_ENABLED: "true",
    OI_SCENE_DATA_DIR: STORE,
  };
  Object.assign(process.env, env);
  const requireOi = createRequire(resolve(OI_ROOT, "package.json"));
  const { chromium, expect } = requireOi("@playwright/test");
  const { createServer } = await import(pathToFileURL(
    join(OI_ROOT, "node_modules/vite/dist/node/index.js"),
  ).href);
  const api = spawn(process.execPath, ["server/index.mjs"], {
    cwd: OI_ROOT, env, stdio: ["ignore", "pipe", "pipe"],
  });
  let apiLog = "";
  api.stdout?.on("data", (bytes: Buffer) => { apiLog += bytes.toString(); });
  api.stderr?.on("data", (bytes: Buffer) => { apiLog += bytes.toString(); });
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const db = new FoundryDatabase(DATABASE);
  try {
    const token = (await db.authenticate({
      username: "local-founder", password: PASSWORD,
    })).token;
    const original = db.read(token, INSTANCE);
    assert.equal(original.revision, 1);
    vite = await createServer({
      root: OI_ROOT,
      configFile: resolve(ROOT, "integrations/openindustries/vite.foundry.config.ts"),
      server: { host: "127.0.0.1", port: 5173, strictPort: true },
    });
    await vite.listen();
    browser = await chromium.launch({
      headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.addInitScript(() => {
      (window as any).__f1Events = [];
      window.addEventListener("nasa-foundry:snapshot", (event) => {
        (window as any).__f1Events.push((event as CustomEvent).detail.revision);
      });
    });
    await page.goto(
      "http://127.0.0.1:5173/?localSceneId=" + session.scene_id,
      { waitUntil: "domcontentloaded" },
    );
    const panel = page.locator("#nasa-foundry-transport");
    await expect(panel).toHaveAttribute("data-runtime-revision", "1", { timeout: 35000 });
    await expect(page.locator(".asset")).toHaveCount(10, { timeout: 35000 });
    const execute = (action: string, expected_revision: number) => db.execute(token, {
      command_id: randomUUID(), instance_id: INSTANCE,
      expected_revision, action, payload: {},
    }).snapshot;
    const started = execute("start", 1);
    await expect(panel).toHaveAttribute(
      "data-runtime-revision", String(started.revision), { timeout: 10000 },
    );
    const advanced = execute("step", started.revision);
    await expect(panel).toHaveAttribute(
      "data-runtime-revision", String(advanced.revision), { timeout: 10000 },
    );
    await expect(panel).toContainText("hopper 0g");
    await expect(panel).toContainText("preheater 0g");
    await expect(panel).toContainText("SIMULATED");
    assert.deepEqual(advanced.inventory_g, {
      site: 9000, transit: 1000, hopper: 0, preheater: 0,
    });
    const observed = await page.evaluate(() => (window as any).__f1Events);
    assert(observed.includes(1) && observed.includes(2) && observed.includes(3));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#nasa-foundry-transport")).toHaveAttribute(
      "data-runtime-revision", "3", { timeout: 35000 },
    );
    await expect(page.locator(".asset")).toHaveCount(10, { timeout: 35000 });
    const screenshot = resolve(ROOT, ".generated/f1-browser.png");
    await page.screenshot({ path: screenshot, fullPage: false });
    await writeFile(resolve(ROOT, ".generated/f1-browser-evidence.json"), JSON.stringify({
      protocol: "nasa.foundry.snapshot.v1",
      scene_id: session.scene_id,
      revisions_received: observed,
      final_revision: advanced.revision,
      simulation_time_ms: advanced.simulation_time_ms,
      mass_conserved: advanced.mass_conserved,
      energy_conserved: advanced.energy_conserved,
      native_oi_asset_count: 10,
      browser_reload_recovered_committed_state: true,
      server_does_not_create_ticks: true,
      screenshot,
    }, null, 2) + "\n");
    console.log("PASS real OI CAD scene + revision SSE + externally committed step + reload.");
  } catch (error) {
    console.error("Browser F1 integration failed; native OI API output:", apiLog.slice(-2000));
    throw error;
  } finally {
    await browser?.close();
    await vite?.close();
    db.close();
    api.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("F1_BROWSER_FAILED", error);
  process.exitCode = 1;
});
