/** Check #4's native semantic pins against actual checked-in engineering sources. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';

export async function buildInspectionMap(root, manifest) {
  const plan = JSON.parse(await readFile(resolve(root, 'scenes/lunar-foundry.plan.json'), 'utf8'));
  const machines = await Promise.all(plan.machines.map(async machine => {
    const instance = manifest.instances.find(i => i.id === machine.id);
    const asset = manifest.bundledAssets.find(a => a.id === instance?.assetId);
    const system = manifest.inspection?.systems.find(s => s.id === machine.id);
    const binding = system?.manifest.bindings.find(b => b.binding_id === machine.id);
    if (!asset || !binding || !system.targets.some(t => t.instanceId === machine.id && t.assetId === asset.id))
      throw Error('INSPECTION_BINDING_MISSING: ' + machine.id);
    const artifacts = await Promise.all([
      ['step', machine.cad, system.manifest.geometry.sha256],
      ['mechanical-ir', machine.mechanical_ir, binding.semantic.sha256],
    ].map(async ([kind, path, expected]) => {
      const file = resolve(root, path), local = relative(resolve(root, 'assets'), file);
      if (local.startsWith('..') || isAbsolute(local)) throw Error('INVALID_INSPECTION_SOURCE');
      const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
      if (sha256 !== expected || (kind === 'step' && sha256 !== asset.source.digest))
        throw Error('INSPECTION_SOURCE_MISMATCH: ' + path);
      return { kind, path, sha256, url: `/api/foundry/artifacts/${machine.id}/${kind}` };
    }));
    return { machine_id: machine.id, name: machine.name, asset_id: asset.id, artifacts };
  }));
  return { version: 1, machines };
}
