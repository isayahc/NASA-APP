/** Actual OI browser + actual SQLite: finite lot/account/port visual acceptance. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { materialView } from '../integrations/openindustries/foundry-material.mjs';
import { buildMaterialMap } from '../integrations/openindustries/foundry-material-map.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OI = resolve(ROOT, 'vendor/openindustries'), OUT = resolve(ROOT, '.generated/issue-13');
async function main() {
  await mkdir(OUT, { recursive: true });
  const session = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.session.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
  const mapping = await buildMaterialMap(ROOT, manifest);
  const scenario = JSON.parse(await readFile(resolve(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
  const requireOi = createRequire(resolve(OI, 'package.json'));
  const { chromium, expect } = requireOi('@playwright/test');
  const { createServer } = await import(pathToFileURL(resolve(OI, 'node_modules/vite/dist/node/index.js')).href);
  const { LocalSceneBackend } = await import(pathToFileURL(resolve(OI, 'server/local-scene-backend.ts')).href);
  const sceneDb = new LocalSceneBackend(session.store_dir);
  const sceneBefore = await sceneDb.head(session.scene_id); sceneDb.close();
  const env = { ...process.env, PORT: '8791', OI_ROOT: OI,
    OI_SCENE_BACKEND: 'local', OI_SCENE_TOOLS_ENABLED: 'true', OI_SCENE_DATA_DIR: session.store_dir };
  const api = spawn(process.execPath, ['server/index.mjs'], { cwd: OI, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  api.stdout?.on('data', b => { logs += b; }); api.stderr?.on('data', b => { logs += b; });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const evidence: any[] = [];
  try {
    for (const mode of ['normal', 'full', 'empty', 'cancel']) {
      const input = structuredClone(scenario);
      if (mode === 'full') input.opening.hopper_regolith_g = input.constraints.hopper_capacity_g;
      if (mode === 'empty') input.opening.source_regolith_g = 0;
      const id = 'f4-' + randomUUID(), password = randomUUID(), database = resolve(OUT, id + '.sqlite');
      const db = new FoundryDatabase(database);
      const { token } = await db.authenticate({ username: 'local-founder', password }, true);
      let state = db.create(token, id, input);
      Object.assign(process.env, env, { NASA_FOUNDRY_DB: database, NASA_FOUNDRY_PASSWORD: password,
        NASA_FOUNDRY_INSTANCE_ID: id, NASA_FOUNDRY_OI_SCENE_ID: session.scene_id });
      let vite: any, context: any;
      try {
        vite = await createServer({ root: OI, configFile: resolve(ROOT, 'integrations/openindustries/vite.foundry.config.ts'),
          server: { port: 5177, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8791' } } });
        await vite.listen();
        context = await browser.newContext({ viewport: { width: 1500, height: 900 },
          ...(mode === 'normal' ? { recordVideo: { dir: OUT, size: { width: 1500, height: 900 } } } : {}) });
        const page = await context.newPage();
        const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
        page.on('console', (m: any) => { if (m.type() === 'error') logs += '\n' + m.text(); });
        await page.goto(`http://127.0.0.1:5177/?localSceneId=${session.scene_id}`, { waitUntil: 'domcontentloaded' });
        const panel = page.locator('#nasa-foundry-material');
        const command = (action: string, payload = {}) => state = db.execute(token, {
          command_id: randomUUID(), instance_id: id, expected_revision: state.revision, action, payload,
        }).snapshot;
        const check = async (stage: string) => {
          await expect(panel).toHaveAttribute('data-runtime-revision', String(state.revision), { timeout: 30000 });
          await expect(panel).toHaveAttribute('data-material-status', 'committed');
          await expect(panel).toHaveAttribute('data-lot-id', input.lot.id);
          const view = materialView(state);
          const ledger = (db.load(id).schedule.domain as any).resources;
          for (const account of view.accounts) {
            const actual = ledger.balances.filter((b: any) => b.account_id === account.account_id && b.unit === 'g')
              .reduce((sum: number, b: any) => sum + b.quantity, 0);
            assert.equal(actual, account.quantity_g);
            const row = panel.locator(`[data-account="${account.account_id}"]`);
            await expect(row).toHaveAttribute('data-quantity-g', String(actual));
            await expect(row).toContainText(`${actual} g (${(actual / 1000).toFixed(3)} kg)`);
            if (account.capacity_g !== null) assert.equal(await row.locator('meter').evaluate((el: HTMLMeterElement) => el.value), actual);
          }
          await expect(panel.locator('[data-feeder-status]')).toContainText('pass-through, no separate stock');
          await expect(panel.locator('[data-material-total-g]')).toHaveAttribute('data-material-total-g', String(view.total_g));
          assert.deepEqual(db.read(token, id), state, 'rendering cannot mutate authority');
          evidence.push({ mode, stage, revision: state.revision, inventory_g: state.inventory_g,
            ledger_sequence: view.ledger_sequence, posting_ids: view.transfers.map((t: any) => t.id) });
          return view;
        };
        await check('initial');
        await expect(page.locator('.asset')).toHaveCount(10, { timeout: 60000 });
        const locate = async (name: RegExp) => {
          const inspector = page.getByRole('region', { name: 'System inspector', exact: true });
          await inspector.getByLabel('Semantic components').getByRole('button', { name }).click();
          await inspector.getByRole('article', { name: 'Binding details' }).getByRole('button', { name: /Locate/ }).click();
        };
        await locate(/Regolith Excavator/);
        if (mode === 'normal') await page.screenshot({ path: resolve(OUT, '13-before.png') });
        command('start'); command('step'); await check('pickup');
        if (mode === 'normal') {
          assert.equal(state.inventory_g.hopper, 0); assert.equal(state.inventory_g.transit, 1000);
          await expect(page.locator('#nasa-foundry-material-anchors line')).toHaveCount(0);
          command('pause', { job_id: 'regolith-delivery' });
          const paused = structuredClone(state.inventory_g); command('step'); await check('paused');
          assert.deepEqual(state.inventory_g, paused);
          await expect(page.locator('#nasa-foundry-material-anchors line')).toHaveCount(0);
          command('resume', { job_id: 'regolith-delivery' });
          while (state.machines[0].status !== 'completed') { command('step'); await check('delivery-progress'); }
          assert.equal(state.inventory_g.hopper, 1000); assert.equal(state.inventory_g.transit, 0);
          await page.screenshot({ path: resolve(OUT, '13-delivered.png') });
          command('set-feeder-blocked', { blocked: true });
          const blocked = state.material.postings; command('step'); await check('feeder-blocked');
          assert.deepEqual(state.material.postings, blocked);
          await expect(panel).toContainText('feeder-blocked');
          command('set-feeder-blocked', { blocked: false });
          for (let i = 1; i <= 5; i++) {
            command('step'); const v = await check('feed-' + i);
            assert.equal(state.inventory_g.hopper, 1000 - i * 200);
            assert.equal(state.inventory_g.preheater, i * 200);
            assert.equal(v.transfers.at(-1).mass_g, 200);
          }
          // Camera-aligned dots use #4 port anchors and actual committed quantities.
          for (const [account, machine, port, name] of [
            ['transit', 'foundry-machine-01', 'regolith_out', /Regolith Excavator/],
            ['hopper', 'foundry-machine-02', 'regolith_in', /Hopper and Screw Feeder/],
            ['preheater', 'foundry-machine-03', 'regolith_in', /Preheating Auger/],
          ] as const) {
            await locate(name);
            const dot = page.locator(`[data-material-account="${account}"]`);
            await expect(dot).toBeVisible();
            await expect(dot).toHaveAttribute('data-quantity-g', String(state.inventory_g[account]));
            const world = (await dot.getAttribute('data-world-m')).split(',').map(Number);
            const expected = mapping.stations.find((s: any) => s.machine_id === machine).ports[port].world_m;
            world.forEach((v: number, i: number) => assert(Math.abs(v - expected[i]) < 1e-8));
          }
          await page.screenshot({ path: resolve(OUT, '13-after.png') });
          await context.setOffline(true);
          await expect(panel).toHaveAttribute('data-material-status', 'stale');
          const revision = state.revision; command('step');
          await expect(panel).toHaveAttribute('data-runtime-revision', String(revision));
          await context.setOffline(false); await check('reconnected');
          await page.reload({ waitUntil: 'domcontentloaded' }); await check('refreshed');
          // Panel remains readable on a narrow viewport; port annotations cull offscreen.
          await page.setViewportSize({ width: 390, height: 844 });
          const box = await panel.boundingBox(); assert(box && box.x >= 0 && box.x + box.width <= 390);
          await page.screenshot({ path: resolve(OUT, '13-mobile.png') });
        } else {
          if (mode === 'cancel') {
            command('cancel', { job_id: 'regolith-delivery' }); await check('cancel-return');
            assert.equal(state.inventory_g.site, 10000); assert.equal(state.inventory_g.transit, 0);
            await expect(panel).toContainText('Excavator cargo → Site stock');
          }
          const unchanged = structuredClone(state.inventory_g), postings = state.material.postings;
          for (let i = 0; i < 6; i++) command('step');
          await check(mode + '-no-credit');
          assert.deepEqual(state.inventory_g, unchanged); assert.deepEqual(state.material.postings, postings);
          await expect(page.locator('#nasa-foundry-material-anchors line')).toHaveCount(0);
          await page.screenshot({ path: resolve(OUT, `13-${mode}.png`) });
        }
        assert.deepEqual(errors, []);
        const video = page.video(); await context.close(); context = null;
        if (video) await video.saveAs(resolve(OUT, '13-material-transfer.webm'));
      } finally { await context?.close(); await vite?.close(); db.close(); }
    }
    const reopened = new LocalSceneBackend(session.store_dir);
    assert.deepEqual(await reopened.head(session.scene_id), sceneBefore); reopened.close();
    await writeFile(resolve(OUT, '13-evidence.json'), JSON.stringify({ status: 'pass',
      scene_revision_unchanged: true, actual_sqlite_ledger_checked: true, checkpoints: evidence }, null, 2));
    console.log('PASS F4: real browser quantities, capacity meters, lot identity and native port anchors; delivery/200g feeding/pause/block/full/empty/cancel/reconnect/refresh.');
  } catch (error) { console.error(logs.slice(-6000)); throw error; }
  finally { await browser.close(); api.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
