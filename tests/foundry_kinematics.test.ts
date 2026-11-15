/** Real STEP/OI parts + committed SQLite jobs, including frozen failure paths. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { buildKinematicsMap } from '../integrations/openindustries/foundry-kinematics-map.mjs';
import { deriveMachinePose, validateProgress } from '../integrations/openindustries/foundry-kinematics.mjs';
import { createWorld, applyWorldPoses } from '../vendor/openindustries/src/lib/world.ts';
import { Matrix4, Vector3 } from '../vendor/openindustries/node_modules/three/build/three.module.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
const mappingReady = buildKinematicsMap(ROOT, manifest);
const closeTo = (a: number[], b: number[]) => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert(Math.abs(v - b[i]) < 1e-8, `${i}: ${v} != ${b[i]}`));
};

test('unique named CAD mappings and native OI mesh transforms include inherited arm/drum/scoops', async () => {
  const mapping = await mappingReady;
  assert.deepEqual(mapping.machines.map((m: any) => Object.keys(m.parts).length), [33, 18, 20]);
  const m = mapping.machines[0];
  const job = { completed_steps: 1, planned_steps: 4, step_duration_ms: 1000 };
  const poses = deriveMachinePose(m, job, mapping.spin_rad_per_work_second);
  const asset = manifest.bundledAssets.find((a: any) => a.id === m.asset_id);
  const world = createWorld([asset], [10, 10, 10]);
  try {
    applyWorldPoses(world.groups, [{ position: [0, 0, 0], rotation: [0, 0, 0], visible: true, parts: poses.parts }]);
    for (const [ref, part] of Object.entries(m.parts) as any) {
      const mesh = world.groups[0].children.find((child: any) => child.userData.partId === part.part_id)!;
      closeTo(mesh.matrix.toArray(), poses.transforms[ref]);
    }
    const arm = m.joints.find((j: any) => j.id === 'joint_arm_l');
    const armMatrix = new Matrix4().fromArray(poses.transforms.arm_l);
    closeTo(new Vector3(...arm.pivot_m).applyMatrix4(armMatrix).toArray(), arm.pivot_m);
    const drum = m.joints.find((j: any) => j.id === 'joint_drum_l');
    closeTo(new Vector3(...drum.pivot_m).applyMatrix4(new Matrix4().fromArray(poses.transforms.drum_l)).toArray(),
      new Vector3(...drum.pivot_m).applyMatrix4(armMatrix).toArray());
    closeTo(poses.transforms.scoop_l_01, poses.transforms.drum_l);
    closeTo(poses.transforms.scoop_r_08, poses.transforms.drum_r);
    closeTo(poses.transforms.chassis, new Matrix4().toArray());
    assert.notDeepEqual(poses.transforms.wheel_l_front, poses.transforms.chassis);
    // 75-degree source arm limit scaled by committed delivery progress.
    assert(Math.abs(poses.angles.joint_arm_l - (75 * Math.PI / 180) * Math.sin(Math.PI / 4)) < 1e-12);
    assert.equal(m.frames.dump_frame.body, 'dump_port');
  } finally { world.dispose(); }
});

test('unknown/ambiguous imported geometry and unsupported hierarchy fail explicitly', async () => {
  const mapping = await mappingReady;
  const corrupt = structuredClone(manifest);
  corrupt.bundledAssets[0].parts[0].vertices = [...corrupt.bundledAssets[0].parts[1].vertices];
  await assert.rejects(buildKinematicsMap(ROOT, corrupt), /AMBIGUOUS_OR_MISSING_PART/);
  const machine = structuredClone(mapping.machines[0]);
  machine.joints[0].parent = machine.joints[0].child;
  assert.throws(() => deriveMachinePose(machine, { completed_steps: 1, planned_steps: 4, step_duration_ms: 1000 }, 1), /INVALID_JOINT_HIERARCHY/);
});

test('real authority pause, blocked feeder, power loss, cancel and replay yield identical frozen poses', async () => {
  const mapping = await mappingReady;
  const directory = mkdtempSync(join(tmpdir(), 'nasa-f3-'));
  const db = new FoundryDatabase(join(directory, 'test.sqlite'));
  try {
    const { token } = await db.authenticate({ username: 'f3-test', password: 'local-kinematics-test-only' }, true);
    let s = db.create(token, 'f3', scenario);
    let seq = 0;
    const exec = (action: string, payload = {}) => s = db.execute(token, {
      command_id: `test-${seq++}`, instance_id: 'f3', expected_revision: s.revision, action, payload,
    }).snapshot;
    const pose = (index: number) => {
      validateProgress(s, mapping);
      return deriveMachinePose(mapping.machines[index], s.machines[index], mapping.spin_rad_per_work_second);
    };
    exec('start'); exec('step');
    const moving = pose(0);
    exec('pause', { job_id: 'regolith-delivery' }); exec('step');
    assert.deepEqual(pose(0), moving);
    exec('resume', { job_id: 'regolith-delivery' }); exec('step');
    assert.notDeepEqual(pose(0), moving);
    while (s.machines[0].status !== 'completed') exec('step');
    exec('set-feeder-blocked', { blocked: true });
    const feeder = pose(1); exec('step'); assert.deepEqual(pose(1), feeder);
    exec('set-feeder-blocked', { blocked: false });
    while (s.machines[2].completed_steps < 1) exec('step');
    const heating = pose(2);
    exec('set-power', { limit_w: 0 }); exec('step');
    assert.deepEqual(pose(2), heating);
    exec('set-power', { limit_w: scenario.constraints.heater_requested_w }); exec('step');
    assert.notDeepEqual(pose(2), heating);
    const resumed = pose(2);
    exec('cancel', { job_id: 'preheat-regolith' }); exec('step');
    assert.deepEqual(pose(2), resumed);
    assert.deepEqual(db.replay(token, 'f3'), s);
    const regressed = structuredClone(s); regressed.machines[2].completed_steps = 0;
    assert.throws(() => validateProgress(regressed, mapping, s), /REGRESSED_TASK_PROGRESS/);
    const before = db.read(token, 'f3'); pose(0); pose(1); pose(2);
    assert.deepEqual(db.read(token, 'f3'), before);
    const shortScenario = structuredClone(scenario);
    shortScenario.constraints.heating_ticks = 1;
    let failed = db.create(token, 'f3-failure', shortScenario);
    const advanceFailure = (action: string) => failed = db.execute(token, {
      command_id: `failure-${seq++}`, instance_id: 'f3-failure', expected_revision: failed.revision, action, payload: {},
    }).snapshot;
    advanceFailure('start');
    for (let i = 0; i < 20 && failed.machines[2].status !== 'failed'; i++) advanceFailure('step');
    assert.equal(failed.machines[2].status, 'failed');
    const failedPose = deriveMachinePose(mapping.machines[2], failed.machines[2], mapping.spin_rad_per_work_second);
    advanceFailure('step');
    assert.deepEqual(deriveMachinePose(mapping.machines[2], failed.machines[2], mapping.spin_rad_per_work_second), failedPose);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
