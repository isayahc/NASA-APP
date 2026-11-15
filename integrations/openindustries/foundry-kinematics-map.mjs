/** Bind named OpenCAD rest meshes to actual, independently tessellated OI STEP solids. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const geometryBytes = asset => JSON.stringify(asset.parts.map(p => [p.id, p.vertices, p.indices]));
export function bounds(vertices) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  vertices.forEach((v, i) => { lo[i % 3] = Math.min(lo[i % 3], v); hi[i % 3] = Math.max(hi[i % 3], v); });
  return [...lo, ...hi];
}
const rotate = ([x, y, z]) => [x, z, -y];
const tasks = ['regolith-delivery', 'hopper-to-preheater', 'preheat-regolith'];
const phases = ['dig-haul-dump', 'meter-regolith', 'heat-to-release'];
const driven = [
  ['joint_wheel_l_front', 'joint_wheel_l_rear', 'joint_wheel_r_front', 'joint_wheel_r_rear',
    'joint_arm_l', 'joint_arm_r', 'joint_drum_l', 'joint_drum_r'],
  ['move_gate', 'spin_auger_shaft', 'spin_auger_flight'],
  ['spin_auger_shaft', 'spin_auger_flight'],
];

export async function buildKinematicsMap(root, manifest) {
  const machines = [];
  for (let n = 1; n <= 3; n++) {
    const machineId = `foundry-machine-0${n}`;
    const instance = manifest.instances.find(i => i.id === machineId);
    const asset = manifest.bundledAssets.find(a => a.id === instance?.assetId);
    if (!asset || asset.source.kind !== 'step') throw Error(`MISSING_CAD: ${machineId}`);
    const source = resolve(root, asset.source.filename);
    const directory = dirname(source);
    const [step, meshBytes, jointBytes, provenanceBytes] = await Promise.all([
      readFile(source), readFile(resolve(directory, 'excavator.meshes.json')),
      readFile(resolve(directory, 'excavator.kinematics.json')), readFile(resolve(directory, 'provenance.json')),
    ]);
    const provenance = JSON.parse(provenanceBytes);
    const verify = (name, bytes) => {
      const entry = Object.entries(provenance.sha256).find(([key]) => key.replaceAll('\\', '/').split('/').at(-1) === name);
      if (!entry || entry[1] !== hash(bytes)) throw Error(`SOURCE_HASH_MISMATCH: ${name}`);
    };
    verify(n === 1 ? 'excavator.step' : 'assembly.step', step);
    verify('excavator.meshes.json', meshBytes);
    verify('excavator.kinematics.json', jointBytes);
    if (hash(step) !== asset.source.digest) throw Error(`STEP_HASH_MISMATCH: ${machineId}`);
    const meshes = JSON.parse(meshBytes), tracks = JSON.parse(jointBytes).tracks;
    if (meshes.length !== asset.parts.length) throw Error(`PART_COUNT_MISMATCH: ${machineId}`);
    const point = p => rotate(p).map((v, i) => v / 1000 - asset.originOffset[i]);
    const parts = {}, claimed = new Set();
    for (const mesh of meshes) {
      const converted = [];
      for (let i = 0; i < mesh.mesh.vertices.length; i += 3)
        converted.push(...point(mesh.mesh.vertices.slice(i, i + 3)));
      const box = bounds(converted);
      // Independent tessellations differ by <1mm for these pinned solids. Never
      // use STEP array order or generic translator names as identity evidence.
      const matches = asset.parts.filter(p => bounds(p.vertices).every((v, i) => Math.abs(v - box[i]) <= 0.001));
      if (matches.length !== 1 || claimed.has(matches[0].id) || parts[mesh.ref_des])
        throw Error(`AMBIGUOUS_OR_MISSING_PART: ${machineId}/${mesh.ref_des}`);
      // OI's BufferGeometry stores Float32 vertices; use its exact pivot precision.
      const part = matches[0], b = bounds(new Float32Array(part.vertices));
      claimed.add(part.id);
      parts[mesh.ref_des] = { part_id: part.id, center_m: b.slice(0, 3).map((v, i) => (v + b[i + 3]) / 2) };
    }
    const joints = tracks.map(({ joint: j }) => {
      const child = j.metadata?.forma_target_ref ?? j.child_shape_id;
      const parent = j.metadata?.forma_parent_ref ?? j.parent_shape_id;
      if (!parts[child] || !parts[parent] || !['fixed', 'revolute'].includes(j.type) ||
          (j.type === 'revolute' && (!driven[n - 1].includes(j.id) || j.unit !== 'radian')) ||
          ![...j.axis, ...j.origin_mm, j.lower_limit, j.upper_limit].every(Number.isFinite) ||
          Math.abs(Math.hypot(...j.axis) - 1) > 1e-8 || j.lower_limit !== 0 ||
          j.upper_limit < 0 || j.upper_limit > 2 * Math.PI + 1e-8)
        throw Error(`UNSUPPORTED_JOINT: ${machineId}/${j.id}`);
      return { id: j.id, type: j.type, child, parent, axis: rotate(j.axis),
        pivot_m: point(j.origin_mm), lower_rad: j.lower_limit, upper_rad: j.upper_limit,
        motion: j.type === 'fixed' ? 'fixed' : /joint_arm_|move_gate/.test(j.id) ? 'lift' : 'spin' };
    });
    if (driven[n - 1].some(id => !joints.some(j => j.id === id))) throw Error(`MISSING_JOINT: ${machineId}`);
    let frames = {};
    if (n === 1) {
      const bytes = await readFile(resolve(directory, 'frames.json'));
      verify('frames.json', bytes);
      frames = JSON.parse(bytes).frames;
    }
    machines.push({ machine_id: machineId, task_id: tasks[n - 1], phase_id: phases[n - 1], asset_id: asset.id,
      step_sha256: hash(step), meshes_sha256: hash(meshBytes), joints_sha256: hash(jointBytes),
      geometry_sha256: hash(geometryBytes(asset)), parts, joints, frames });
  }
  return { version: 1, origin: 'simulated', validity: 'derived',
    frame: 'right-handed Y-up meters; Euler XYZ degrees at OI boundary',
    spin_rad_per_work_second: Math.PI / 4, machines };
}
