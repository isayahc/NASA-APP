/** Pure committed-progress presentation; no clock, controller writes or scene edits. */
import { Matrix4, Vector3, Euler, Quaternion, MathUtils } from '../../vendor/openindustries/node_modules/three/build/three.module.js';

export function validateProgress(snapshot, mapping, previous = null) {
  for (const machine of mapping.machines) {
    const matches = snapshot.machines.filter(j => j.id === machine.task_id && j.machine_id === machine.machine_id);
    const job = matches[0];
    if (matches.length !== 1 || !Number.isSafeInteger(job.completed_steps) || job.completed_steps < 0 ||
        !Number.isSafeInteger(job.planned_steps) || job.planned_steps < 1 || job.completed_steps > job.planned_steps ||
        !Number.isSafeInteger(job.step_duration_ms) || job.step_duration_ms < 1)
      throw Error(`INVALID_TASK_PROGRESS: ${machine.task_id}`);
    const old = previous?.machines.find(j => j.id === job.id);
    if (old && (old.completed_steps > job.completed_steps || old.planned_steps !== job.planned_steps ||
        old.step_duration_ms !== job.step_duration_ms)) throw Error(`REGRESSED_TASK_PROGRESS: ${job.id}`);
  }
}

export function deriveMachinePose(machine, job, spinRate) {
  const byChild = new Map(machine.joints.map(j => [j.child, j]));
  if (byChild.size !== machine.joints.length) throw Error('DUPLICATE_JOINT_CHILD');
  const matrices = new Map(), angles = {}, visiting = new Set();
  const evaluate = ref => {
    if (matrices.has(ref)) return matrices.get(ref);
    if (!machine.parts[ref] || visiting.has(ref)) throw Error(`INVALID_JOINT_HIERARCHY: ${ref}`);
    visiting.add(ref);
    const j = byChild.get(ref);
    let matrix = new Matrix4();
    if (j) {
      const progress = job.completed_steps / job.planned_steps;
      const angle = j.motion === 'fixed' ? 0 : j.motion === 'lift' ?
        j.upper_rad * Math.sin(Math.PI * progress) :
        (job.completed_steps * job.step_duration_ms / 1000 * spinRate) % (2 * Math.PI);
      if (angle < j.lower_rad - 1e-10 || angle > j.upper_rad + 1e-10) throw Error(`JOINT_LIMIT: ${j.id}`);
      angles[j.id] = angle;
      const [x, y, z] = j.pivot_m;
      const local = new Matrix4().makeTranslation(x, y, z)
        .multiply(new Matrix4().makeRotationAxis(new Vector3(...j.axis), angle))
        .multiply(new Matrix4().makeTranslation(-x, -y, -z));
      matrix = evaluate(j.parent).clone().multiply(local);
    }
    visiting.delete(ref);
    matrices.set(ref, matrix);
    return matrix;
  };
  const parts = {}, transforms = {};
  for (const [ref, part] of Object.entries(machine.parts)) {
    const matrix = evaluate(ref), center = new Vector3(...part.center_m);
    // OI rotates about each mesh's own bounds center. Compensate translation
    // so its native applyWorldPoses produces the composed joint-pivot matrix.
    const position = center.clone().applyMatrix4(matrix).sub(center).toArray();
    const e = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(matrix), 'XYZ');
    parts[part.part_id] = { position, rotation: [e.x, e.y, e.z].map(MathUtils.radToDeg) };
    transforms[ref] = matrix.toArray();
  }
  return { parts, transforms, angles };
}
