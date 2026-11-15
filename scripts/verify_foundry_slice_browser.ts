/** F6: one actual OI browser/controller slice, with receipt-by-receipt conservation. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, totalmem, platform, arch } from 'node:os';
import { FoundryDatabase, type FoundrySnapshot, type Scenario } from '../integrations/openindustries/foundry-runtime.ts';
import { buildKinematicsMap } from '../integrations/openindustries/foundry-kinematics-map.mjs';
import { deriveMachinePose } from '../integrations/openindustries/foundry-kinematics.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OI = resolve(ROOT, 'vendor/openindustries'), OUT = resolve(ROOT, '.generated/issue-15');
const BASE = 'http://127.0.0.1:5181';
const sha = (data: any) => createHash('sha256').update(data).digest('hex');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function conserved(s: FoundrySnapshot, scenario: Scenario) {
  const initial = scenario.opening.source_regolith_g + (scenario.opening.hopper_regolith_g ?? 0);
  assert.equal(Object.values(s.inventory_g).reduce((a, b) => a + b, 0), initial);
  for (const a of s.material.accounts) {
    assert(Number.isSafeInteger(a.quantity_g) && a.quantity_g >= 0);
    if (a.capacity_g !== null) assert(a.quantity_g <= a.capacity_g);
    assert.equal(a.lot_id, scenario.lot.id);
  }
  assert.equal(s.energy_mJ.available + s.energy_mJ.spent, scenario.opening.available_energy_mJ);
  assert.equal(s.energy_mJ.spent, s.thermal.input_energy_mJ);
  const sensible = Math.floor(s.inventory_g.preheater * scenario.constraints.heat_capacity_J_kg_K *
    (s.thermal.temperature_mK - scenario.constraints.initial_temperature_mK) / 1000);
  assert.equal(sensible + s.thermal.lost_energy_mJ + s.thermal.numerical_residual_mJ, s.thermal.input_energy_mJ);
  assert(s.thermal.numerical_residual_mJ >= 0);
  assert.equal(s.provenance.origin, 'simulated'); assert.equal(s.provenance.validity, 'modeled');
  assert(s.mass_conserved && s.energy_conserved);
  assert(s.observations.every(o => o.origin === 'simulated' && o.validity === 'modeled'));
}
const stats = (values: number[]) => {
  assert(values.length > 0, 'performance samples required');
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) };
};

async function main() {
  await mkdir(OUT, { recursive: true });
  // No model invocation is part of this acceptance run. Remove provider credentials
  // from both Vite and its native API child, without printing any values.
  const providerKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
    'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'XAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    ...Object.keys(process.env).filter(k => /_API_KEY$/.test(k) ||
      /^(OPENAI|ANTHROPIC|AZURE_OPENAI|BEDROCK|VERTEX|GOOGLE|GEMINI|OPENROUTER|GROQ|XAI|COHERE|MISTRAL|DEEPSEEK)_.*(TOKEN|SECRET|CREDENTIAL)/.test(k))];
  for (const key of providerKeys) delete process.env[key];
  const fixturePath = 'scenarios/lunar-south-pole/live-slice-e2e.json';
  const fixture = JSON.parse(await readFile(resolve(ROOT, fixturePath), 'utf8'));
  assert.equal(git(OI, 'rev-parse', 'HEAD'), fixture.oi_commit);
  const scenarioBase = JSON.parse(await readFile(resolve(ROOT, fixture.base_scenario), 'utf8'));
  scenarioBase.opening.source_regolith_g = fixture.source_regolith_g;
  const session = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.session.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
  const mapping = await buildKinematicsMap(ROOT, manifest);
  const plan = JSON.parse(await readFile(resolve(ROOT, 'scenes/lunar-foundry.plan.json'), 'utf8'));
  const sources = await Promise.all([fixturePath, fixture.base_scenario, 'scenes/lunar-foundry.plan.json',
    'integrations/openindustries/foundry-runtime.ts', 'integrations/openindustries/foundry-controls.ts',
    'scripts/verify_foundry_slice_browser.ts', ...plan.machines.flatMap((m: any) => [m.cad, m.mechanical_ir])]
    .map(async path => ({ path, sha256: sha(await readFile(resolve(ROOT, path))) })));
  const requireOi = createRequire(resolve(OI, 'package.json'));
  const { chromium, expect } = requireOi('@playwright/test');
  const { createServer } = await import(pathToFileURL(resolve(OI, 'node_modules/vite/dist/node/index.js')).href);
  const { LocalSceneBackend } = await import(pathToFileURL(resolve(OI, 'server/local-scene-backend.ts')).href);
  const sceneStore = new LocalSceneBackend(session.store_dir);
  const sceneBefore = await sceneStore.head(session.scene_id); sceneStore.close();
  const env = { ...process.env, PORT: '8795', OI_ROOT: OI,
    OI_SCENE_BACKEND: 'local', OI_SCENE_TOOLS_ENABLED: 'true', OI_SCENE_DATA_DIR: session.store_dir };
  const api = spawn(process.execPath, ['server/index.mjs'], { cwd: OI, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  api.stdout?.on('data', b => { logs += b; }); api.stderr?.on('data', b => { logs += b; });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results: any[] = [];
  try {
    for (const mode of ['normal', ...fixture.failure_cases]) {
      const scenario = structuredClone(scenarioBase);
      if (mode === 'empty-site') scenario.opening.source_regolith_g = 0;
      if (mode === 'full-hopper') scenario.opening.hopper_regolith_g = scenario.constraints.hopper_capacity_g;
      const rootId = 'f6-' + randomUUID(), password = randomUUID(), database = resolve(OUT, rootId + '.sqlite');
      const db = new FoundryDatabase(database);
      const { token } = await db.authenticate({ username: 'local-founder', password }, true);
      db.create(token, rootId, scenario);
      const current = () => db.read(token, db.lineage(token, rootId).at(-1)!);
      Object.assign(process.env, env, { NASA_FOUNDRY_DB: database, NASA_FOUNDRY_PASSWORD: password,
        NASA_FOUNDRY_INSTANCE_ID: rootId, NASA_FOUNDRY_OI_SCENE_ID: session.scene_id });
      let vite: any, context: any;
      try {
        vite = await createServer({ root: OI, configFile: resolve(ROOT, 'integrations/openindustries/vite.foundry.config.ts'),
          server: { port: 5181, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8795' } } });
        await vite.listen();
        context = await browser.newContext({ viewport: fixture.viewport,
          ...(mode === 'normal' ? { recordVideo: { dir: OUT, size: fixture.viewport } } : {}) });
        const page = await context.newPage(), errors: string[] = [], selectionTimes: number[] = [], speedSamples: any[] = [];
        page.on('pageerror', (e: Error) => { errors.push(e.message); logs += '\n' + e.message; });
        await page.addInitScript({ content: `(() => {
          const w = window;
          w.__slice = { events: [], commands: [], frames: [], raf: [] };
          const native = window.EventSource;
          window.EventSource = class extends native {
            constructor(url, options) {
              super(url, options); if (String(url).includes('/api/foundry/events')) w.__sliceSource = this;
            }
          };
          window.addEventListener('nasa-foundry:snapshot', event => {
            w.__slice.events.push({ frame: event.detail, at: performance.now() });
          });
          const original = window.fetch;
          window.fetch = async (...args) => {
            const command = String(args[0]) === '/api/foundry/commands' ? JSON.parse(String(args[1]?.body)) : null;
            const at = performance.now(), response = await original(...args);
            if (command) {
              const result = await response.clone().json();
              w.__slice.commands.push({ command, at, response_at: performance.now(), status: response.status,
                revision: result.snapshot?.revision, instance_id: result.snapshot?.instance_id });
            }
            return response;
          };
          let previous = 0, rendered = '';
          function sample(now) {
            if (previous) w.__slice.raf.push(now - previous);
            previous = now;
            const canvas = document.querySelector('canvas[data-render-frames]');
            if (canvas && canvas.dataset.renderFrames !== rendered) {
              rendered = canvas.dataset.renderFrames;
              w.__slice.frames.push({ at: now, cpu_ms: Number(canvas.dataset.lastCpuFrameMs),
                frames: Number(rendered), draw_calls: Number(canvas.dataset.drawCalls) });
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        })();` });
        await page.goto(`${BASE}/?localSceneId=${session.scene_id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.asset')).toHaveCount(10, { timeout: 60000 });
        const controls = page.getByRole('region', { name: 'Foundry controls', exact: true });
        const inspector = page.getByRole('region', { name: 'System inspector', exact: true });
        const live = inspector.getByRole('region', { name: 'Foundry runtime inspection', exact: true });
        const material = page.locator('#nasa-foundry-material');
        const checkpoints: any[] = [];
        const select = async (index: number) => {
          const at = performance.now();
          await inspector.getByLabel('Semantic components').getByRole('button', { name: new RegExp(plan.machines[index].name) }).click();
          await expect(live).toHaveAttribute('data-machine-id', plan.machines[index].id);
          selectionTimes.push(performance.now() - at);
        };
        const check = async (stage: string, index = 2) => {
          const state = current(); conserved(state, scenario);
          await expect(controls).toHaveAttribute('data-runtime-revision', String(state.revision), { timeout: 15000 });
          await expect(material).toHaveAttribute('data-runtime-revision', String(state.revision));
          await expect(page.locator('#nasa-foundry-kinematics')).toHaveAttribute('data-runtime-revision', String(state.revision), { timeout: 15000 });
          const poses = await page.evaluate(() => (window as any).__NASA_FOUNDRY_POSES);
          assert.equal(poses.instance_id, state.instance_id);
          let parts = 0;
          for (let i = 0; i < 3; i++) {
            const machine = mapping.machines[i], expected = deriveMachinePose(machine, state.machines[i], mapping.spin_rad_per_work_second);
            for (const [ref, actual] of Object.entries(poses.machines[i].parts) as any) {
              parts++; assert.equal(actual.part_id, machine.parts[ref].part_id);
              actual.matrix.forEach((n: number, j: number) => assert(Math.abs(n - expected.transforms[ref][j]) < 1e-8));
            }
          }
          assert.equal(parts, 71);
          for (const [account, quantity] of Object.entries(state.inventory_g))
            await expect(material.locator(`[data-account="${account}"]`)).toHaveAttribute('data-quantity-g', String(quantity));
          await select(index);
          await expect(live).toHaveAttribute('data-runtime-revision', String(state.revision));
          await expect(live.locator('[data-field="job"]')).toHaveText(state.machines[index].id);
          await expect(live.locator('[data-field="status"]')).toHaveText(state.controls.started ? state.machines[index].status : 'not started');
          await expect(live.locator('[data-field="reason"]')).toHaveText(state.machines[index].reason ?? 'none');
          if (index === 2) {
            await expect(live.locator('[data-field="temperature"]')).toContainText(`${state.thermal.temperature_mK} mK`);
            await expect(live.locator('[data-field="spent"]')).toHaveText(`${state.energy_mJ.spent} mJ`);
            await expect(live.locator('[data-field="ready"]')).toHaveText(String(state.thermal.output_ready));
          }
          assert.deepEqual(db.replay(token, state.instance_id), state);
          checkpoints.push({ stage, state, native_part_count: parts, matrices_sha256: sha(JSON.stringify(poses.machines)) });
          return { state, poses };
        };
        const click = async (label: string, step = false) => {
          const before = current();
          const response = page.waitForResponse((r: any) => r.url() === BASE + '/api/foundry/commands' && r.request().method() === 'POST');
          await controls.getByRole('button', { name: label, exact: true }).click();
          const reply = await response;
          assert.equal(reply.status(), 200);
          const committed = (await reply.json()).snapshot;
          assert.equal(committed.revision, before.revision + 1);
          assert.equal(committed.simulation_time_ms, before.simulation_time_ms + (step ? 1000 : 0));
          if (label === 'Resume') await expect.poll(async () => Number(await controls.getAttribute('data-runtime-revision'))).toBeGreaterThanOrEqual(committed.revision);
          else await expect(controls).toHaveAttribute('data-runtime-revision', String(committed.revision), { timeout: 10000 });
          await expect(controls.getByRole('alert')).toHaveCount(0);
          return committed;
        };
        const initial = await check('initial', 0);
        await page.screenshot({ path: resolve(OUT, `15-${mode}-before.png`) });
        await click('Start'); await check('start', 0);
        for (let i = 1; i <= 4; i++) {
          await click('Step', true); const { state } = await check('delivery-' + i, 0);
          if (mode === 'normal') assert.equal(state.inventory_g.hopper, i === 4 ? 1000 : 0);
        }
        if (mode !== 'normal') {
          const failed = await check(mode, 0);
          assert.equal(failed.state.machines[0].reason, mode === 'empty-site' ? 'source-depleted' : 'hopper-full');
          const held = structuredClone(failed.state.inventory_g);
          await click('Step', true); await check(mode + '-retained', 0);
          assert.deepEqual(current().inventory_g, held);
          await page.screenshot({ path: resolve(OUT, `15-${mode}.png`) });
        } else {
          await controls.getByText('Operating constraints', { exact: true }).click();
          await click('Block feeder');
          const blockedBefore = await check('before-block', 1);
          await click('Step', true); const blocked = await check('blocked', 1);
          assert.equal(blocked.state.machines[1].reason, 'feeder-blocked');
          assert.deepEqual(blocked.poses.machines, blockedBefore.poses.machines);
          await click('Unblock feeder');
          for (let i = 1; i <= 5; i++) {
            await click('Step', true); const { state } = await check('feed-' + i, 1);
            assert.equal(state.inventory_g.hopper, 1000 - i * 200);
            assert.equal(state.inventory_g.preheater, i * 200);
          }
          await click('Cut heater power');
          const cold = await check('before-power-cut');
          await click('Step', true); const powerless = await check('power-cut');
          assert.equal(powerless.state.machines[2].reason, 'insufficient-power');
          assert.deepEqual(powerless.poses.machines, cold.poses.machines);
          assert.deepEqual(powerless.state.thermal, cold.state.thermal);
          await click('Restore heater power'); await click('Step', true); await check('heat-started');
          for (const speed of fixture.speed_multipliers) {
            const before = current();
            await controls.getByLabel('Simulation speed', { exact: true }).selectOption(String(speed));
            await expect(controls).toHaveAttribute('data-runtime-revision', String(before.revision + 1));
            assert.equal(current().controls.speed, speed);
            const resumed = await click('Resume');
            await expect.poll(() => current().simulation_time_ms, { timeout: 15000, intervals: [40] }).toBeGreaterThan(before.simulation_time_ms);
            // Pause is revision-aware even during a running clock. A concurrent
            // tick can legitimately conflict; retry only after the new SSE head.
            for (let retry = 0; retry < 8 && current().controls.running; retry++) {
              await expect.poll(async () => Number(await controls.getAttribute('data-runtime-revision'))).toBe(current().revision);
              await controls.getByRole('button', { name: 'Pause', exact: true }).click();
              await expect(controls.getByRole('status')).not.toContainText('Submitting');
            }
            assert.equal(current().controls.running, false);
            const paused = await check('speed-' + speed);
            speedSamples.push(await page.evaluate(({ revision, time, speed }) => {
              const events = (window as any).__slice.events;
              const start = events.find((e: any) => e.frame.revision === revision);
              const tick = events.find((e: any) => e.frame.revision > revision && e.frame.simulation_time_ms > time);
              if (!start || !tick) throw Error('Missing speed sample');
              return { speed, configured_interval_ms: 1000 / speed, observed_sse_first_tick_ms: tick.at - start.at,
                simulated_ms_advanced_at_first_observed_tick: tick.frame.simulation_time_ms - time };
            }, { revision: resumed.revision, time: resumed.simulation_time_ms, speed }));
            await page.waitForTimeout(350);
            assert.deepEqual(current(), paused.state, 'Pause stops the authoritative clock');
          }
          const retained = await check('before-disconnect');
          await click('Resume');
          await context.setOffline(true);
          await expect(live).toHaveAttribute('data-freshness', 'stale');
          await expect.poll(() => current().controls.running).toBe(false);
          const disconnected = current();
          await page.waitForTimeout(600);
          assert.deepEqual(current(), disconnected, 'stream loss stops authorized automatic work');
          await expect(controls.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
          await expect(live.locator('[data-field="temperature"]')).toContainText(`${retained.state.thermal.temperature_mK} mK`);
          await context.setOffline(false); await check('reconnected');
          await click('Resume');
          await page.evaluate(() => {
            (window as any).__sliceSource.close();
            (window as any).__sliceSource.dispatchEvent(new Event('error'));
          });
          await expect(live).toHaveAttribute('data-freshness', 'stale');
          await expect.poll(() => current().controls.running).toBe(false);
          const lostStream = current();
          await page.waitForTimeout(350);
          assert.deepEqual(current(), lostStream);
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
          await check('stream-loss-recovered');
          // Inject only previously captured real frames into the existing EventSource.
          const oldCount = await page.evaluate(() => {
            const w = window as any, events = w.__slice.events, count = events.length;
            for (const index of [1, 0, events.length - 1])
              w.__sliceSource.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(events[index].frame) }));
            return { before: count, after: w.__slice.events.length };
          });
          assert.equal(oldCount.before, oldCount.after);
          await check('out-of-order-retained');
          while (current().machines[2].status !== 'completed') {
            assert(current().machines[2].completed_steps < 66, 'finite completion bound');
            await click('Step', true); await check('heat-' + current().machines[2].completed_steps);
          }
          const complete = current();
          assert.deepEqual(complete.inventory_g, { site: 0, transit: 0, hopper: 0, preheater: 1000 });
          assert(complete.thermal.output_ready && complete.thermal.lost_energy_mJ > 0);
          const completionCommand = JSON.parse(String(db.db.prepare('SELECT request FROM nasa_foundry_receipts ORDER BY rowid DESC LIMIT 1').get()!.request));
          const duplicateCompletion = await context.request.post(BASE + '/api/foundry/commands', {
            headers: { Origin: BASE, 'X-Foundry-Command': '1' }, data: completionCommand,
          });
          assert.equal(duplicateCompletion.status(), 200);
          assert.deepEqual((await duplicateCompletion.json()).snapshot, complete);
          assert.deepEqual(current(), complete, 'completion receipt replay must not spend twice');
          assert.notDeepEqual((await check('completed')).poses.machines, initial.poses.machines);
          await live.locator('[data-field="temperature"]').scrollIntoViewIfNeeded();
          await page.screenshot({ path: resolve(OUT, '15-completed.png') });
          // Real camera interaction; capture native draw CPU timings and rAF cadence,
          // never claim the on-demand renderer continuously runs at a fabricated FPS.
          const canvas = page.locator('canvas[data-render-frames]');
          const box = await canvas.boundingBox(); assert(box);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 30, { steps: 20 }); await page.mouse.up();
          const metrics = await page.evaluate(() => {
            const canvas = document.querySelector('canvas[data-render-frames]') as HTMLCanvasElement;
            const gl = canvas.getContext('webgl2')!, debug = gl.getExtension('WEBGL_debug_renderer_info');
            return { ...((window as any).__slice), renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
              native_canvas: { ...canvas.dataset }, user_agent: navigator.userAgent };
          });
          const latency = metrics.commands.filter((c: any) => c.status === 200).map((c: any) => {
            const event = metrics.events.find((e: any) => e.frame.instance_id === c.instance_id && e.frame.revision === c.revision);
            assert(event, 'every manual command receipt must have accepted SSE readback');
            return event.at - c.at;
          });
          assert(latency.every((v: number) => v >= 0));
          const performanceReport = { measurement: 'browser fetch submission to accepted SSE; native CPU draw submission; rAF cadence; Playwright selection roundtrip',
            submit_to_snapshot_ms: stats(latency), native_cpu_draw_ms: stats(metrics.frames.map((f: any) => f.cpu_ms)),
            speed_samples: speedSamples,
            browser_raf_interval_ms: stats(metrics.raf), selection_roundtrip_ms: stats(selectionTimes),
            renderer: metrics.renderer, native_canvas: metrics.native_canvas, user_agent: metrics.user_agent,
            note: 'Headless SwiftShader, on-demand renderer. CPU draw timing is not GPU completion, rAF is not rendered FPS; includes test/instrumentation overhead.' };
          await writeFile(resolve(OUT, '15-performance.json'), JSON.stringify(performanceReport, null, 2));
          await page.reload({ waitUntil: 'domcontentloaded' }); await check('reload-completed');
          assert.deepEqual(current(), complete);
          await expect(controls.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
          await expect(controls.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
          const oldRun = current();
          await controls.getByRole('button', { name: 'Reset — new run', exact: true }).click();
          await expect.poll(() => current().instance_id).not.toBe(oldRun.instance_id);
          await expect(controls).toHaveAttribute('data-run-id', current().instance_id, { timeout: 30000 });
          await check('reset-new-run', 0);
          await page.evaluate(old => {
            (window as any).__sliceSource.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify(old) }));
          }, { protocol: 'nasa.foundry.snapshot.v1', instance_id: complete.instance_id, scene_id: complete.scene_id,
            revision: complete.revision, simulation_time_ms: complete.simulation_time_ms, origin: 'simulated', validity: 'modeled', snapshot: complete });
          await expect(controls).toHaveAttribute('data-run-id', current().instance_id);
          assert.equal(current().revision, 1); assert.equal(current().simulation_time_ms, 0);
          assert.deepEqual(db.replay(token, oldRun.instance_id).inventory_g, oldRun.inventory_g);
          await page.screenshot({ path: resolve(OUT, '15-reset.png') });
          await page.setViewportSize({ width: 390, height: 844 });
          await controls.scrollIntoViewIfNeeded(); await expect(controls.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
          await page.screenshot({ path: resolve(OUT, '15-mobile-controls.png') });
        }
        // Inspect every native command receipt, including clock ticks skipped by
        // latest-head streaming; no unchecked intermediate conservation failures.
        const receipts = db.db.prepare('SELECT request,result FROM nasa_foundry_receipts ORDER BY rowid').all()
          .map((r: any) => ({ request: JSON.parse(r.request), snapshot: JSON.parse(r.result).snapshot }));
        const previous = new Map<string, { revision: number; simulation_time_ms: number }>();
        for (const receipt of receipts) {
          conserved(receipt.snapshot, scenario);
          const prior = previous.get(receipt.snapshot.instance_id) ?? { revision: 1, simulation_time_ms: 0 };
          assert.equal(receipt.request.expected_revision, prior.revision);
          assert.equal(receipt.snapshot.revision, prior.revision + 1);
          assert.equal(receipt.snapshot.simulation_time_ms, prior.simulation_time_ms +
            (['step', 'clock-step'].includes(receipt.request.action) ? scenario.constraints.tick_ms : 0));
          previous.set(receipt.snapshot.instance_id, receipt.snapshot);
        }
        // Re-execute the recorded first-run trace in an independent real authority.
        const replayDb = new FoundryDatabase(resolve(OUT, rootId + '-determinism.sqlite'));
        try {
          const auth = await replayDb.authenticate({ username: 'determinism', password: randomUUID() }, true);
          replayDb.create(auth.token, rootId, scenario);
          for (const receipt of receipts) {
            const replayed = replayDb.execute(auth.token, receipt.request).snapshot;
            assert.deepEqual(replayed, receipt.snapshot, 'identical scenario/commands reproduce complete snapshots');
          }
        } finally { replayDb.close(); }
        assert.deepEqual(errors, []);
        const video = page.video(); await context.close(); context = null;
        if (video) await video.saveAs(resolve(OUT, '15-complete-slice.webm'));
        const evidence = { mode, scenario, all_committed_receipts_checked: receipts.length, deterministic_reexecution: true, checkpoints, receipts };
        results.push({ mode, receipts: receipts.length, checkpoints: checkpoints.length });
        await writeFile(resolve(OUT, `15-${mode}-evidence.json`), JSON.stringify(evidence, null, 2));
      } finally { await context?.close(); await vite?.close(); db.close(); }
    }
    const after = new LocalSceneBackend(session.store_dir);
    assert.deepEqual(await after.head(session.scene_id), sceneBefore); after.close();
    await writeFile(resolve(OUT, '15-manifest.json'), JSON.stringify({ status: 'pass', results, scenario_fixture: fixture,
      oi_commit: git(OI, 'rev-parse', 'HEAD'), app_commit: git(ROOT, 'rev-parse', 'HEAD'),
      app_worktree_dirty: Boolean(git(ROOT, 'status', '--porcelain', '--untracked-files=no')),
      source_hashes: sources, portable_scene_sha256: sha(await readFile(resolve(ROOT, '.generated/lunar-foundry.oi.json'))),
      scene_revision_unchanged: true, provider_credentials_absent: providerKeys.every(k => !process.env[k]),
      environment: { platform: platform(), arch: arch(), node: process.version, chromium: browser.version(),
        cpu: cpus()[0]?.model, logical_cpus: cpus().length, memory_bytes: totalmem(), viewport: fixture.viewport,
        rendering: 'headless Chromium with --use-angle=swiftshader --enable-unsafe-swiftshader' } }, null, 2));
    console.log('PASS F6: real browser controls, 71 CAD parts, ledger/inspection, full preheat, all receipt balances, reset/reload/reconnect, deterministic reexecution and measured performance.');
  } catch (error) { console.error(logs.slice(-6000)); throw error; }
  finally { await browser.close(); api.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
