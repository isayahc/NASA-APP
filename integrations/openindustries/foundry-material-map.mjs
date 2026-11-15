/** Reuse #4's actual layout/port calculation; do not invent transport anchors. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildMaterialMap(root, manifest) {
  // Runtime import keeps the executable scene builder outside Vite's config bundle.
  const { checkPlan, makeLayout } = await import(pathToFileURL(resolve(root, 'scripts/build_lunar_scene.mjs')).href);
  const plan = JSON.parse(await readFile(resolve(root, 'scenes/lunar-foundry.plan.json'), 'utf8'));
  const { machines, links } = checkPlan(plan);
  const assets = machines.map(machine => {
    const item = manifest.instances.find(i => i.id === machine.id);
    const asset = manifest.bundledAssets.find(a => a.id === item?.assetId);
    if (!item || !asset) throw Error('MISSING_MATERIAL_MACHINE: ' + machine.id);
    return { machine, asset, cadHash: asset.source.digest, irHash: '', position: null };
  });
  const { graph } = makeLayout(plan, assets, links, false);
  const stations = graph.stations.filter(s => s.number <= 3).map(s => {
    const item = manifest.instances.find(i => i.id === s.id);
    if (item.position.some((v, i) => v !== s.position_m[i]) || item.rotation.some(v => v !== 0))
      throw Error('MATERIAL_LAYOUT_MISMATCH: ' + s.id);
    return { machine_id: s.id, asset_id: s.asset_id, cad_sha256: s.cad_sha256, ports: s.ports };
  });
  const routes = graph.links.filter(l => l.kind === 'regolith' && stations.some(s => s.machine_id === l.to));
  if (routes.length !== 2) throw Error('MISSING_MATERIAL_PORT_ROUTE');
  return { version: 1, scene_id: graph.scene, stations, routes,
    note: '#4 declared port anchors, not verified pipe/contact geometry; site has no spatial anchor' };
}
