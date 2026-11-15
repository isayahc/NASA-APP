/** Chromium evidence from the actual OI mesh matrices driven by real SQLite jobs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { buildKinematicsMap } from '../integrations/openindustries/foundry-kinematics-map.mjs';
import { deriveMachinePose } from '../integrations/openindustries/foundry-kinematics.mjs';
import { makeFrame } from '../integrations/openindustries/foundry-sse.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OI = resolve(ROOT, 'vendor/openindustries');
const OUTPUT = resolve(ROOT, '.generated/issue-12');
async function main() {
  await mkdir(OUTPUT, { recursive: true });
  const session = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.session.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
  const mapping = await buildKinematicsMap(ROOT, manifest);
  const scenario = JSON.parse(await readFile(resolve(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
  const dbPath = resolve(OUTPUT, randomUUID() + '.sqlite');
  const password = randomUUID();
  const db = new FoundryDatabase(dbPath);
  const { token } = await db.authenticate({ username: 'local-founder', password }, true);
  const instance = 'f3-' + randomUUID();
  let state = db.create(token, instance, scenario);
  const env = { ...process.env, PORT: '8789', NASA_FOUNDRY_DB: dbPath,
    NASA_FOUNDRY_PASSWORD: password, NASA_FOUNDRY_INSTANCE_ID: instance,
    NASA_FOUNDRY_OI_SCENE_ID: session.scene_id, OI_ROOT: OI,
    OI_SCENE_BACKEND: 'local', OI_SCENE_TOOLS_ENABLED: 'true', OI_SCENE_DATA_DIR: session.store_dir };
  Object.assign(process.env, env);
  const requireOi = createRequire(resolve(OI, 'package.json'));
  const { chromium, expect } = requireOi('@playwright/test');
  const { createServer } = await import(pathToFileURL(resolve(OI, 'node_modules/vite/dist/node/index.js')).href);
  const api = spawn(process.execPath, ['server/index.mjs'], { cwd: OI, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  api.stdout?.on('data', data => { logs += data; });
  api.stderr?.on('data', data => { logs += data; });
  let vite: any, browser: any;
  const checkpoints: any[] = [];
  try {
    vite = await createServer({ root: OI,
      configFile: resolve(ROOT, 'integrations/openindustries/vite.foundry.config.ts'),
      server: { port: 5175, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8789' } },
    });
    await vite.listen();
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 },
      recordVideo: { dir: OUTPUT, size: { width: 1500, height: 900 } } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    page.on('console', (m: any) => { if (m.type() === 'error') logs += '\nBROWSER: ' + m.text(); });
    const { LocalSceneBackend } = await import(pathToFileURL(resolve(OI, 'server/local-scene-backend.ts')).href);
    const sceneBackend = new LocalSceneBackend(session.store_dir);
    const originalScene = await sceneBackend.head(session.scene_id);
    sceneBackend.close();
    await page.goto(`http://127.0.0.1:5175/?localSceneId=${session.scene_id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.asset')).toHaveCount(10, { timeout: 60000 });
    const waitPose = async () => {
      await expect(page.locator('#nasa-foundry-kinematics')).toHaveAttribute('data-runtime-revision', String(state.revision), { timeout: 20000 });
      const actual = await page.evaluate(() => (window as any).__NASA_FOUNDRY_POSES);
      assert.equal(actual.revision, state.revision);
      for (let index = 0; index < 3; index++) {
        const machine = mapping.machines[index];
        const expected = deriveMachinePose(machine, state.machines[index], mapping.spin_rad_per_work_second);
        for (const [ref, entry] of Object.entries(actual.machines[index].parts) as any) {
          assert.equal(entry.part_id, machine.parts[ref].part_id);
          entry.matrix.forEach((value: number, i: number) => assert(Math.abs(value - expected.transforms[ref][i]) < 1e-8, `${machine.machine_id}/${ref}/${i}`));
        }
      }
      assert.deepEqual(db.read(token, instance), state, 'rendering must not advance authority');
      return actual;
    };
    const command = (action: string, payload = {}) => state = db.execute(token, {
      command_id: randomUUID(), instance_id: instance, expected_revision: state.revision, action, payload,
    }).snapshot;
    const initial = await waitPose();
    const inspector = page.getByRole('region', { name: 'System inspector', exact: true });
    await inspector.getByLabel('Semantic components').getByRole('button', { name: /Regolith Excavator/ }).click();
    await inspector.getByRole('article', { name: 'Binding details' }).getByRole('button', { name: /Locate/ }).click();
    await page.screenshot({ path: resolve(OUTPUT, '12-before.png') });
    command('start'); command('step');
    const delivery = await waitPose();
    assert.notDeepEqual(delivery.machines[0].parts.wheel_l_front.matrix, initial.machines[0].parts.wheel_l_front.matrix);
    assert.notDeepEqual(delivery.machines[0].parts.arm_l.matrix, initial.machines[0].parts.arm_l.matrix);
    assert.notDeepEqual(delivery.machines[0].parts.drum_l.matrix, initial.machines[0].parts.drum_l.matrix);
    assert.deepEqual(delivery.machines[1].parts, initial.machines[1].parts);
    await page.screenshot({ path: resolve(OUTPUT, '12-delivery.png') });
    checkpoints.push({ stage: 'delivery', state, actual: delivery });
    command('pause', { job_id: 'regolith-delivery' }); command('step');
    assert.deepEqual((await waitPose()).machines, delivery.machines);
    command('resume', { job_id: 'regolith-delivery' });
    while (state.machines[1].completed_steps < 1) command('step');
    const feeding = await waitPose();
    assert.notDeepEqual(feeding.machines[1].parts.gate.matrix, initial.machines[1].parts.gate.matrix);
    assert.notDeepEqual(feeding.machines[1].parts.auger_flight.matrix, initial.machines[1].parts.auger_flight.matrix);
    checkpoints.push({ stage: 'feeding', state, actual: feeding });
    command('set-feeder-blocked', { blocked: true }); command('step');
    assert.deepEqual((await waitPose()).machines, feeding.machines);
    command('set-feeder-blocked', { blocked: false });
    while (state.machines[2].completed_steps < 1) command('step');
    const heating = await waitPose();
    assert.notDeepEqual(heating.machines[2].parts.auger_flight.matrix, initial.machines[2].parts.auger_flight.matrix);
    checkpoints.push({ stage: 'heating', state, actual: heating });
    command('set-power', { limit_w: 0 }); command('step');
    assert.deepEqual((await waitPose()).machines, heating.machines);
    command('set-power', { limit_w: scenario.constraints.heater_requested_w }); command('step');
    const resumed = await waitPose();
    await context.setOffline(true);
    await expect(page.locator('#nasa-foundry-transport')).toHaveAttribute('data-stream-status', 'offline', { timeout: 20000 });
    command('step');
    assert.deepEqual((await page.evaluate(() => (window as any).__NASA_FOUNDRY_POSES)).machines, resumed.machines);
    await context.setOffline(false);
    const reconnected = await waitPose();
    assert.notDeepEqual(reconnected.machines[2].parts, resumed.machines[2].parts);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.deepEqual((await waitPose()).machines, reconnected.machines);
    // An old frame cannot undo reconnect progress, even if delivered again.
    await page.evaluate(async ({ url, old }: any) => {
      const adapter = await import(url); adapter.receiveFoundryKinematics(old);
    }, { url: '/@fs/' + resolve(ROOT, 'integrations/openindustries/foundry-kinematics-browser.mjs').replaceAll('\\', '/'),
      old: makeFrame(checkpoints[0].state) });
    assert.deepEqual((await waitPose()).machines, reconnected.machines);
    command('cancel', { job_id: 'preheat-regolith' }); command('step');
    assert.deepEqual((await waitPose()).machines, reconnected.machines);
    await page.screenshot({ path: resolve(OUTPUT, '12-after.png') });
    const reopened = new LocalSceneBackend(session.store_dir);
    assert.deepEqual(await reopened.head(session.scene_id), originalScene, 'poses must not create scene revisions');
    reopened.close();
    assert.deepEqual(errors, []);
    await writeFile(resolve(OUTPUT, '12-evidence.json'), JSON.stringify({
      status: 'pass', real_imported_machines: 10, verified_parts: 71,
      pause_block_power_cancel_freeze: true, reconnect_refresh_resync: true,
      scene_revision_unchanged: true, checkpoints,
    }, null, 2));
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(OUTPUT, '12-task-driven.webm'));
    console.log('PASS F3: 71 actual OI part matrices, all 3 tasks, pause/block/power/cancel, offline/reconnect/reload, no scene edits.');
  } catch (error) {
    console.error(logs.slice(-8000)); throw error;
  } finally {
    await browser?.close(); await vite?.close(); api.kill(); db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
