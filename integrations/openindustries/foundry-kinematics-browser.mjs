/** Opt-in ephemeral pose adapter for the pinned OI WorkspaceViewer boundary. */
import { deriveMachinePose, validateProgress } from './foundry-kinematics.mjs';

let mapping = null, sceneId = null, frame = null, evidence = null;
let status = 'waiting', problem = null;
const verified = new WeakMap();
export const POSE_EVENT = 'nasa-foundry:pose';
const wake = () => window.dispatchEvent(new Event(POSE_EVENT));
function display(next, error = null) {
  status = next; problem = error;
  let panel = document.getElementById('nasa-foundry-kinematics');
  if (!panel) {
    panel = document.createElement('aside'); panel.id = 'nasa-foundry-kinematics';
    panel.setAttribute('role', 'status');
    panel.style.cssText = 'position:fixed;right:16px;bottom:210px;z-index:20000;max-width:310px;background:#121620;color:#e6e9ef;padding:10px;font:12px/1.5 monospace;pointer-events:none';
    document.body.appendChild(panel);
  }
  panel.dataset.kinematicsStatus = status;
  panel.textContent = error ? `Kinematics unavailable: ${error}` :
    'SIMULATED / DERIVED joint poses · committed work only · in-place wheels; no terrain/travel physics or mechanical validation';
}

export function configureFoundryKinematics(value, oiSceneId) {
  if (value.version !== 1 || value.validity !== 'derived' || value.machines.length !== 3)
    throw Error('INVALID_KINEMATICS_MAP');
  mapping = value; sceneId = oiSceneId; display('waiting'); wake();
}

export function receiveFoundryKinematics(next) {
  if (!mapping) return;
  if (frame && (next.instance_id !== frame.instance_id || next.revision <= frame.revision ||
      next.simulation_time_ms < frame.simulation_time_ms)) return;
  try {
    validateProgress(next.snapshot, mapping, frame?.snapshot);
    // Validate every hierarchy/limit before replacing a last-known-good frame.
    for (const machine of mapping.machines)
      deriveMachinePose(machine, next.snapshot.machines.find(j => j.id === machine.task_id), mapping.spin_rad_per_work_second);
    frame = next; problem = null; wake();
  } catch (error) { display('error', error.message); }
}

async function verifyGeometry(asset, machine) {
  const bytes = new TextEncoder().encode(JSON.stringify(asset.parts.map(p => [p.id, p.vertices, p.indices])));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== machine.geometry_sha256) throw Error(`CAD_GEOMETRY_MISMATCH: ${machine.machine_id}`);
}

export function foundryRuntimePoses(items, base) {
  if (!mapping || !frame || new URL(window.location.href).searchParams.get('localSceneId') !== sceneId) return base;
  if (!items.length) return base; // Native OI scene is still loading.
  try {
    let ready = true;
    for (const machine of mapping.machines) {
      const item = items.find(i => i.id === machine.machine_id);
      if (!item || item.missing || item.asset.id !== machine.asset_id || item.asset.source.digest !== machine.step_sha256)
        throw Error(`UNSUPPORTED_CAD_BINDING: ${machine.machine_id}`);
      const record = verified.get(item.asset);
      if (!record) {
        const pending = { ready: false, error: null }; verified.set(item.asset, pending);
        void verifyGeometry(item.asset, machine).then(() => { pending.ready = true; wake(); })
          .catch(error => { pending.error = error; display('error', error.message); });
      }
      if (record?.error) throw record.error;
      if (!record?.ready) ready = false;
    }
    if (!ready) return base;
    return items.map((item, index) => {
      const machine = mapping.machines.find(m => m.machine_id === item.id);
      if (!machine) return base[index];
      const job = frame.snapshot.machines.find(j => j.id === machine.task_id);
      return { ...base[index], parts: deriveMachinePose(machine, job, mapping.spin_rad_per_work_second).parts };
    });
  } catch (error) { display('error', error.message); return base; }
}

/** Read matrices from OI's actual rendered meshes, not a parallel presentation. */
export function reportFoundryWorld(groups, items) {
  if (!frame || !mapping || problem || new URL(window.location.href).searchParams.get('localSceneId') !== sceneId ||
      mapping.machines.some(m => !verified.get(items.find(i => i.id === m.machine_id)?.asset)?.ready)) return;
  const machines = mapping.machines.map(machine => {
    const group = groups[items.findIndex(i => i.id === machine.machine_id)];
    return { machine_id: machine.machine_id, task_id: machine.task_id,
      parts: Object.fromEntries(Object.entries(machine.parts).map(([ref, part]) => {
        const mesh = group.children.find(m => m.userData.partId === part.part_id);
        return [ref, { part_id: part.part_id, matrix: mesh.matrix.toArray(), matrix_world: mesh.matrixWorld.toArray() }];
      })) };
  });
  evidence = { revision: frame.revision, instance_id: frame.instance_id,
    origin: 'simulated', validity: 'derived', machines };
  if (status !== 'applied') display('applied');
  document.getElementById('nasa-foundry-kinematics').dataset.runtimeRevision = String(frame.revision);
}

if (typeof window !== 'undefined') Object.defineProperty(window, '__NASA_FOUNDRY_POSES', {
  configurable: true, get: () => evidence ? structuredClone(evidence) : null,
});
