/** Durable transition evidence and engineering pins, using the actual OI authority. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { buildInspectionMap } from '../integrations/openindustries/foundry-inspection-map.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
test('inspection records actual transitions, retains them through work, and survives restart/replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nasa-f5-')), path = join(directory, 'state.sqlite');
  let db = new FoundryDatabase(path);
  const credentials = { username: 'inspection-test', password: 'local-test-inspection-password' };
  let { token } = await db.authenticate(credentials, true);
  let snapshot = db.create(token, 'inspection', scenario), sequence = 0;
  const command = (action: string, payload = {}) => snapshot = db.execute(token, {
    command_id: `inspection-${sequence++}`, instance_id: 'inspection', expected_revision: snapshot.revision, action, payload,
  }).snapshot;
  try {
    assert.equal(snapshot.machines[0].scheduled, false);
    assert.equal(snapshot.machines[0].last_transition, null);
    command('start');
    assert.deepEqual(snapshot.machines[0].last_transition, {
      from: null, to: 'queued', reason: null, phase_id: 'dig-haul-dump', action: 'start', revision: 2, at_ms: 0,
    });
    command('step'); command('pause', { job_id: 'regolith-delivery' });
    const pause = snapshot.machines[0].last_transition;
    assert.equal(pause?.from, 'running'); assert.equal(pause?.to, 'paused');
    command('step'); assert.deepEqual(snapshot.machines[0].last_transition, pause);
    command('resume', { job_id: 'regolith-delivery' });
    for (let i = 0; i < 3; i++) command('step');
    assert.equal(snapshot.machines[0].last_transition?.to, 'completed');
    command('set-feeder-blocked', { blocked: true }); command('step');
    assert.equal(snapshot.machines[1].last_transition?.reason, 'feeder-blocked');
    const blocked = snapshot;
    db.close(); db = new FoundryDatabase(path);
    token = (await db.authenticate(credentials)).token;
    assert.deepEqual(db.read(token, 'inspection'), blocked);
    assert.deepEqual(db.replay(token, 'inspection'), blocked);
    command('set-power', { limit_w: 0 });
    assert.equal(snapshot.power.available_limit_w, 0);
    assert.equal(snapshot.power.requested_limit_w, scenario.constraints.heater_requested_w);
    command('set-feeder-blocked', { blocked: false });
    for (let i = 0; i < 6; i++) command('step');
    assert.equal(snapshot.machines[2].reason, 'insufficient-power');
    assert.equal(snapshot.thermal.input_energy_mJ, 0);
    command('set-power', { limit_w: 900 });
    for (let i = 0; i < scenario.constraints.heating_ticks; i++) command('step');
    assert.equal(snapshot.thermal.output_ready, true);
    assert.equal(snapshot.machines[2].last_transition?.to, 'completed');
    assert.deepEqual(db.replay(token, 'inspection'), snapshot);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('all ten native inspection pins resolve; tampered STEP/MechanicalIR pins fail closed', async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
  const map = await buildInspectionMap(ROOT, manifest);
  assert.equal(map.machines.length, 10);
  for (const machine of map.machines) {
    assert.equal(machine.artifacts.length, 2);
    assert(machine.artifacts.every(a => /^[a-f0-9]{64}$/.test(a.sha256)));
  }
  const bad = structuredClone(manifest);
  bad.inspection.systems[0].manifest.bindings[0].semantic.sha256 = '0'.repeat(64);
  await assert.rejects(buildInspectionMap(ROOT, bad), /INSPECTION_SOURCE_MISMATCH/);
  const badCad = structuredClone(manifest);
  badCad.bundledAssets[0].source.digest = '0'.repeat(64);
  await assert.rejects(buildInspectionMap(ROOT, badCad), /INSPECTION_SOURCE_MISMATCH/);
});
