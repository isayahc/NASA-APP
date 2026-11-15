/** Ledger quantities and settled-posting annotations in the native OI viewport. */
import { Vector3 } from '../../vendor/openindustries/node_modules/three/build/three.module.js';
import { materialView, LABELS } from './foundry-material.mjs';

let mapping = null, sceneId = null, accepted = null, view = null, panel = null;
let overlay = null, canvasOwner = null, connected = true;
const quantity = g => `${g} g (${(g / 1000).toFixed(3)} kg)`;
const element = (tag, text, parent) => {
  const node = document.createElement(tag); node.textContent = text; parent?.appendChild(node); return node;
};
const activeScene = () => new URL(window.location.href).searchParams.get('localSceneId') === sceneId;
const wake = () => window.dispatchEvent(new Event('nasa-foundry:pose'));

export function configureFoundryMaterial(map, id) {
  if (map.version !== 1 || map.scene_id !== 'lunar-foundry-mvp' || map.stations.length !== 3)
    throw Error('INVALID_MATERIAL_MAP');
  mapping = map; sceneId = id;
  panel = element('section', '', document.body);
  panel.id = 'nasa-foundry-material'; panel.setAttribute('aria-label', 'Regolith ledger');
  panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:20001;width:370px;max-width:calc(100vw - 32px);max-height:43vh;overflow:auto;box-sizing:border-box;background:#172320;color:#f0edda;border:1px solid #b5b17a;border-radius:8px;padding:10px;font:12px/1.45 monospace';
  panel.textContent = 'Regolith ledger · awaiting committed quantities';
}

function renderPanel() {
  if (!panel || !view) return;
  const wasOpen = panel.querySelector('details')?.open ?? false;
  const scrollTop = panel.scrollTop;
  panel.replaceChildren();
  panel.dataset.runtimeRevision = String(accepted.revision);
  panel.dataset.materialStatus = connected ? 'committed' : 'stale';
  panel.dataset.lotId = view.lot.id;
  element('strong', `REGOLITH · ${view.lot.id} · SIMULATED`, panel);
  element('div', `Revision ${accepted.revision} · ${connected ? 'Committed balances' : 'OFFLINE — retained balances, stale'}`, panel);
  const table = element('table', '', panel); table.style.width = '100%';
  for (const account of view.accounts) {
    const row = element('tr', '', table); row.dataset.account = account.account_id;
    row.dataset.quantityG = String(account.quantity_g); row.dataset.lotId = account.lot_id;
    row.dataset.capacityG = account.capacity_g === null ? 'unbounded-storage' : String(account.capacity_g);
    row.dataset.ownerId = account.owner_id ?? 'unassigned';
    element('th', account.label, row).style.textAlign = 'left';
    const cell = element('td', quantity(account.quantity_g), row);
    element('div', `${account.state} · ${account.capacity_g === null ? 'finite source stock' : 'capacity ' + account.capacity_g + ' g'}`, cell);
    if (account.capacity_g !== null) {
      const meter = element('meter', '', cell);
      meter.min = 0; meter.max = account.capacity_g || 1; meter.value = account.quantity_g;
      meter.setAttribute('aria-label', `${account.label} mass capacity in grams`);
      meter.style.width = '100%';
    }
  }
  element('div', `Total conserved: ${quantity(view.total_g)}`, panel).dataset.materialTotalG = String(view.total_g);
  const feeder = element('div', `Feeder: ${view.feeder.status}${view.feeder.reason ? ' / ' + view.feeder.reason : ''} · ${view.feed_g_per_step} g/settled step · pass-through, no separate stock`, panel);
  feeder.dataset.feederStatus = view.feeder.status;
  element('div', `Delivery: ${view.delivery.status}${view.delivery.reason ? ' / ' + view.delivery.reason : ''}`, panel);
  const recent = view.transfers.at(-1);
  const history = element('div', recent ?
    `Last settled: ${LABELS[recent.source]} → ${LABELS[recent.destination]} · ${recent.mass_g} g @ ${recent.at_ms / 1000}s (history, not live flow)` :
    'No material posting in retained ledger tail', panel);
  history.dataset.lastPostingId = recent?.id ?? '';
  const details = element('details', '', panel);
  details.open = wasOpen;
  element('summary', 'Lot composition, ownership and posting history', details);
  element('div', `Provenance: ${view.lot.provenance}`, details);
  element('div', `Composition assumption: ${view.lot.composition.source}; oxide-bearing mass fraction ${view.lot.composition.oxygen_bearing_oxide_mass_fraction}; remainder: ${view.lot.composition.remainder}. Not an oxygen yield.`, details);
  for (const a of view.accounts) element('div', `${a.account_id}: ${a.kind}, owner ${a.owner_id ?? 'unassigned by ledger'}, lot ${a.lot_id}`, details);
  element('div', 'Bounded ledger posting tail (no animation; not a second inventory):', details);
  for (const transfer of view.transfers) {
    const line = element('div', `#${transfer.sequence} ${transfer.source} → ${transfer.destination}: ${transfer.mass_g} g @ ${transfer.at_ms / 1000}s`, details);
    line.dataset.postingId = transfer.id;
  }
  panel.scrollTop = scrollTop;
}

export function receiveFoundryMaterial(frame) {
  if (!mapping || !activeScene()) return;
  if (accepted && (frame.instance_id !== accepted.instance_id || frame.revision <= accepted.revision ||
      frame.simulation_time_ms < accepted.simulation_time_ms)) return;
  try {
    const next = materialView(frame.snapshot, accepted?.snapshot);
    accepted = frame; view = next; connected = true; renderPanel(); wake();
  } catch (error) {
    if (panel) { panel.dataset.materialStatus = 'error'; element('div', error.message, panel); }
    // Preserve the previous quantities; never interpolate from an invalid frame.
  }
}

export function setMaterialConnection(online) {
  connected = online; renderPanel(); wake();
}

/** Native camera projection of #4 declared ports; SVG is an annotation, not mass. */
export function renderFoundryMaterial(groups, items, camera, canvas) {
  if (panel) panel.hidden = !activeScene();
  if (!mapping || !view || !activeScene()) { overlay?.remove(); overlay = null; return; }
  if (canvasOwner !== canvas || !overlay) {
    overlay?.remove(); canvasOwner = canvas;
    overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.id = 'nasa-foundry-material-anchors';
    overlay.setAttribute('aria-label', 'Committed material annotations at declared machine ports');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:3';
    canvas.parentElement.appendChild(overlay);
  }
  overlay.replaceChildren();
  const width = canvas.clientWidth, height = canvas.clientHeight;
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.dataset.runtimeRevision = String(accepted.revision);
  camera.updateMatrixWorld();
  const point = (machineId, port) => {
    const station = mapping.stations.find(s => s.machine_id === machineId);
    const index = items.findIndex(i => i.id === machineId), item = items[index], group = groups[index];
    if (!station || !item || !group || item.missing || item.asset.id !== station.asset_id ||
        item.asset.source.digest !== station.cad_sha256 || !station.ports[port])
      throw Error('UNSUPPORTED_MATERIAL_ANCHOR: ' + machineId + '/' + port);
    if (!group.visible) return null;
    const world = new Vector3(...station.ports[port].local_m).applyMatrix4(group.matrixWorld);
    const p = world.clone().project(camera);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
    return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, world: world.toArray() };
  };
  const svg = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    overlay.appendChild(node); return node;
  };
  try {
    // Receipt lines are static and explicitly historical. No moving particles,
    // arrow pulses, invented conveyor inventory, or continuous flow indicators.
    for (const route of mapping.routes) {
      const source = route.from === 'foundry-machine-01' ? 'transit' : 'hopper';
      const destination = source === 'transit' ? 'hopper' : 'preheater';
      const posting = view.transfers.filter(t => t.source === source && t.destination === destination).at(-1);
      const a = point(route.from, route.from_port), b = point(route.to, route.to_port);
      if (!posting || !a || !b) continue;
      svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#beb991', 'stroke-dasharray': '3 5',
        'data-settled-posting': posting.id, 'data-mass-g': posting.mass_g, 'data-history': 'true' });
      const label = svg('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 18,
        fill: '#fff3bc', 'font-size': 11, 'text-anchor': 'middle', stroke: '#172320', 'stroke-width': 3, 'paint-order': 'stroke' });
      label.textContent = `${posting.mass_g} g settled @${posting.at_ms / 1000}s (history)`;
    }
    for (const [id, machineId, port, label] of [
      ['transit', 'foundry-machine-01', 'regolith_out', 'Cargo'],
      ['hopper', 'foundry-machine-02', 'regolith_in', 'Hopper'],
      ['preheater', 'foundry-machine-03', 'regolith_in', 'WIP'],
    ]) {
      const p = point(machineId, port); if (!p) continue;
      const account = view.accounts.find(a => a.account_id === id);
      const dot = svg('circle', { cx: p.x, cy: p.y, r: 5, fill: '#d7ce84', stroke: '#172320',
        'data-material-account': id, 'data-port': `${machineId}/${port}`, 'data-world-m': p.world.join(','),
        'data-quantity-g': account.quantity_g, 'data-lot-id': account.lot_id });
      dot.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')).textContent = `${label}: ${quantity(account.quantity_g)} · declared port`;
      const text = svg('text', { x: Math.max(65, Math.min(width - 65, p.x)), y: Math.max(15, p.y - (id === 'hopper' ? 30 : 12)),
        fill: '#fff3bc', 'font-size': 12, 'text-anchor': 'middle', stroke: '#172320', 'stroke-width': 3, 'paint-order': 'stroke' });
      text.textContent = `${label} ${account.quantity_g} g${connected ? '' : ' (stale)'}`;
    }
  } catch (error) {
    overlay.replaceChildren(); overlay.dataset.error = error.message;
    if (panel.dataset.anchorError !== error.message) {
      panel.dataset.anchorError = error.message; element('div', error.message, panel);
    }
  }
}

export function removeFoundryMaterialOverlay(canvas) {
  if (canvasOwner === canvas) { overlay?.remove(); overlay = null; canvasOwner = null; }
}
