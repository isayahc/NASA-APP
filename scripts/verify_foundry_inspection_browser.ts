/** Native OI selection + authoritative SQLite + F1 SSE; no fabricated telemetry. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OI = resolve(ROOT, 'vendor/openindustries'), OUT = resolve(ROOT, '.generated/issue-14');
async function main() {
  await mkdir(OUT, { recursive: true });
  const session = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.session.json'), 'utf8'));
  const scenario = JSON.parse(await readFile(resolve(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
  const plan = JSON.parse(await readFile(resolve(ROOT, 'scenes/lunar-foundry.plan.json'), 'utf8'));
  const id = 'f5-' + randomUUID(), password = randomUUID(), database = resolve(OUT, id + '.sqlite');
  const db = new FoundryDatabase(database);
  const { token } = await db.authenticate({ username: 'local-founder', password }, true);
  let state = db.create(token, id, scenario);
  const env = { ...process.env, PORT: '8793', OI_ROOT: OI,
    OI_SCENE_BACKEND: 'local', OI_SCENE_TOOLS_ENABLED: 'true', OI_SCENE_DATA_DIR: session.store_dir,
    NASA_FOUNDRY_DB: database, NASA_FOUNDRY_PASSWORD: password,
    NASA_FOUNDRY_INSTANCE_ID: id, NASA_FOUNDRY_OI_SCENE_ID: session.scene_id };
  Object.assign(process.env, env);
  const requireOi = createRequire(resolve(OI, 'package.json'));
  const { chromium, expect } = requireOi('@playwright/test');
  const { createServer } = await import(pathToFileURL(resolve(OI, 'node_modules/vite/dist/node/index.js')).href);
  const { LocalSceneBackend } = await import(pathToFileURL(resolve(OI, 'server/local-scene-backend.ts')).href);
  const sceneDb = new LocalSceneBackend(session.store_dir);
  const before = await sceneDb.head(session.scene_id); sceneDb.close();
  const api = spawn(process.execPath, ['server/index.mjs'], { cwd: OI, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '', vite: any, browser: any;
  api.stdout?.on('data', b => { logs += b; }); api.stderr?.on('data', b => { logs += b; });
  const evidence: any[] = [];
  try {
    vite = await createServer({ root: OI, configFile: resolve(ROOT, 'integrations/openindustries/vite.foundry.config.ts'),
      server: { port: 5179, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8793' } } });
    await vite.listen();
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 },
      recordVideo: { dir: OUT, size: { width: 1500, height: 900 } } });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', (e: Error) => { errors.push(e.message); logs += '\nPAGE: ' + e.message + '\n' + e.stack; });
    page.on('console', (m: any) => { if (m.type() === 'error') logs += '\n' + m.text(); });
    // Capture the actual EventSource only to replay captured stale frames and
    // connection faults through its existing listeners, never synthesize readings.
    await page.addInitScript(() => {
      const Native = window.EventSource;
      (window as any).__f5Frames = [];
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          if (String(url).includes('/api/foundry/events')) {
            (window as any).__f5Source = this;
            this.addEventListener('snapshot', e => (window as any).__f5Frames.push((e as MessageEvent).data));
          }
        }
      };
    });
    await page.goto(`http://127.0.0.1:5179/?localSceneId=${session.scene_id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.asset')).toHaveCount(10, { timeout: 60000 });
    const inspector = page.getByRole('region', { name: 'System inspector', exact: true });
    const panel = inspector.getByRole('region', { name: 'Foundry runtime inspection', exact: true });
    const field = (name: string) => panel.locator(`[data-field="${name}"]`);
    const select = async (index: number) => {
      await inspector.getByLabel('Semantic components').getByRole('button', { name: new RegExp(plan.machines[index].name) }).click();
      await expect(panel).toHaveAttribute('data-machine-id', plan.machines[index].id);
      await panel.scrollIntoViewIfNeeded();
    };
    const command = (action: string, payload = {}) => state = db.execute(token, {
      command_id: randomUUID(), instance_id: id, expected_revision: state.revision, action, payload,
    }).snapshot;
    const check = async (index: number, stage: string) => {
      await select(index);
      await expect(panel).toHaveAttribute('data-runtime-revision', String(state.revision), { timeout: 20000 });
      await expect(panel).toHaveAttribute('data-freshness', 'fresh');
      await expect(panel).toContainText('origin: simulated · validity: modeled');
      await expect(field('time')).toHaveText(`${state.simulation_time_ms} ms`);
      const stored = db.load(id), task = state.machines[index];
      if (index < 3) {
        await expect(field('job')).toHaveText(task.id);
        const job = stored.schedule.jobs.find(j => j.id === task.id);
        await expect(field('status')).toHaveText(job?.state ?? 'not started');
        await expect(field('reason')).toHaveText(job?.reason ?? 'none');
        await expect(field('phase')).toHaveText(job?.phases[job.phase_index]?.id ?? 'unavailable (no active phase)');
        for (const a of state.material.accounts) {
          if (await field('mass-' + a.account_id).count()) {
            const raw = (stored.schedule.domain as any).resources.balances
              .filter((b: any) => b.account_id === a.account_id && b.lot_id === scenario.lot.id)
              .reduce((sum: number, b: any) => sum + b.quantity, 0);
            await expect(field('mass-' + a.account_id)).toContainText(`${raw} g · lot ${scenario.lot.id}`);
          }
        }
        if (index === 2) {
          const thermal = (stored.schedule.domain as any).thermal;
          await expect(field('temperature')).toHaveText(`${thermal.temperature_mK} mK (${(thermal.temperature_mK / 1000).toFixed(3)} K)`);
          for (const [key, value] of Object.entries({ spent: state.energy_mJ.spent,
            'heat-input': thermal.input_energy_mJ, 'heat-loss': thermal.lost_energy_mJ, residual: thermal.numerical_residual_mJ }))
            await expect(field(key)).toHaveText(`${value} mJ`);
          await expect(field('power-limit')).toHaveText(`${(stored.schedule.domain as any).power_limit_w} W`);
          await expect(field('last-power')).toHaveText(`${thermal.last_applied_power_w} W`);
          await expect(field('ready')).toHaveText(String(thermal.output_ready));
        }
      } else {
        await expect(panel.locator('[data-executable="false"]')).toContainText('Not executable');
        await expect(field('temperature')).toHaveCount(0);
        await expect(field('spent')).toHaveCount(0);
      }
      assert.deepEqual(db.read(token, id), state);
      evidence.push({ stage, machine: plan.machines[index].id, revision: state.revision, snapshot: state });
    };
    await check(0, 'before');
    await page.screenshot({ path: resolve(OUT, '14-before.png') });
    // Every engineering link returns exactly the pinned checked-in artifact bytes.
    for (let i = 0; i < 10; i++) {
      await check(i, 'sources');
      for (const [kind, file] of [['step', plan.machines[i].cad], ['mechanical-ir', plan.machines[i].mechanical_ir]]) {
        const url = await panel.locator(`[data-artifact="${kind}"]`).getAttribute('href');
        const response = await context.request.get('http://127.0.0.1:5179' + url);
        assert.equal(response.status(), 200);
        const digest = createHash('sha256').update(await response.body()).digest('hex');
        assert.equal(digest, createHash('sha256').update(await readFile(resolve(ROOT, file))).digest('hex'));
        await expect(panel).toContainText(digest);
      }
    }
    command('start'); await check(0, 'start');
    command('step'); await check(0, 'pickup');
    command('pause', { job_id: 'regolith-delivery' }); await check(0, 'pause');
    await expect(field('transition')).toContainText('running → paused');
    const pausedTransition = await field('transition').textContent();
    command('step'); await check(0, 'paused-step');
    await expect(field('transition')).toHaveText(pausedTransition);
    command('resume', { job_id: 'regolith-delivery' });
    for (let i = 0; i < 3; i++) command('step');
    await check(1, 'delivered');
    command('set-feeder-blocked', { blocked: true }); command('step'); await check(1, 'blocked');
    await expect(field('reason')).toHaveText('feeder-blocked');
    command('set-feeder-blocked', { blocked: false });
    for (let i = 0; i < 5; i++) command('step');
    command('step'); await check(2, 'heating');
    command('set-power', { limit_w: 0 }); command('step'); await check(2, 'power-cut');
    await expect(field('reason')).toHaveText('insufficient-power');
    command('set-power', { limit_w: 900 }); command('step'); await check(2, 'power-restored');
    await page.screenshot({ path: resolve(OUT, '14-after.png') });
    // Native Locate changes geometry selection, then the asset list selects another machine.
    await inspector.getByRole('article', { name: 'Binding details' }).getByRole('button', { name: /Locate/ }).click();
    await expect(panel).toHaveAttribute('data-machine-id', 'foundry-machine-03');
    await page.locator('.asset').filter({ hasText: 'Regolith Excavator' }).click();
    await expect(panel).toHaveAttribute('data-machine-id', 'foundry-machine-01');
    await check(2, 'geometry-selection');
    const retained = await panel.textContent();
    await page.evaluate(() => {
      const w = window as any;
      w.__f5Source.dispatchEvent(new MessageEvent('snapshot', { data: w.__f5Frames[0] }));
    });
    assert.equal(await panel.textContent(), retained, 'old frames must not rewind inspection');
    await context.setOffline(true);
    await expect(panel).toHaveAttribute('data-freshness', 'stale');
    await expect(panel).toContainText('STALE');
    const heldTemperature = await field('temperature').textContent(), heldRevision = state.revision;
    command('step');
    await expect(panel).toHaveAttribute('data-runtime-revision', String(heldRevision));
    await expect(field('temperature')).toHaveText(heldTemperature);
    await page.screenshot({ path: resolve(OUT, '14-stale.png') });
    await context.setOffline(false); await check(2, 'reconnected');
    // A transport open alone cannot mark cached values fresh; same-head health can.
    await page.evaluate(() => {
      const source = (window as any).__f5Source;
      source.close(); source.dispatchEvent(new Event('error')); source.dispatchEvent(new Event('open'));
    });
    await expect(panel).toHaveAttribute('data-freshness', 'stale');
    await page.evaluate(({ instance_id, revision }) => {
      (window as any).__f5Source.dispatchEvent(new MessageEvent('authority-health', {
        data: JSON.stringify({ instance_id, revision }),
      }));
    }, { instance_id: id, revision: state.revision });
    await expect(panel).toHaveAttribute('data-freshness', 'fresh');
    // Advance the browser clock only; a silent stream must expire without a
    // fabricated revision or simulation step. Native EventSource is already closed.
    await page.clock.install();
    await page.evaluate(({ instance_id, revision }) => {
      (window as any).__f5Source.dispatchEvent(new MessageEvent('authority-health', {
        data: JSON.stringify({ instance_id, revision }),
      }));
    }, { instance_id: id, revision: state.revision });
    await page.clock.fastForward(35001);
    await expect(panel).toHaveAttribute('data-freshness', 'stale');
    assert.deepEqual(db.read(token, id), state);
    await page.reload({ waitUntil: 'domcontentloaded' }); await check(2, 'reload');
    assert.deepEqual(db.replay(token, id), state);
    command('cancel', { job_id: 'preheat-regolith' }); await check(2, 'cancel');
    await expect(field('transition')).toContainText('→ cancelled');
    await field('heat-loss').scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(OUT, '14-thermal.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await check(2, 'narrow');
    await page.screenshot({ path: resolve(OUT, '14-mobile.png') });
    const reopened = new LocalSceneBackend(session.store_dir);
    assert.deepEqual(await reopened.head(session.scene_id), before); reopened.close();
    assert.deepEqual(errors, []);
    const video = page.video(); await context.close(); await video.saveAs(resolve(OUT, '14-inspection.webm'));
    await writeFile(resolve(OUT, '14-evidence.json'), JSON.stringify({ status: 'pass',
      native_inspector: true, artifact_links_verified: 20, scene_revision_unchanged: true, checkpoints: evidence }, null, 2));
    console.log('PASS F5: native selection, SQLite task/material/thermal readings, 20 source links, pause/block/power/cancel, stale/reconnect/reload.');
  } catch (error) { console.error(logs.slice(-7000)); throw error; }
  finally { await browser?.close(); await vite?.close(); api.kill(); db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
