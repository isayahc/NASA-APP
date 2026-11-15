/** A section of OI's native System Inspector, sharing its geometry/semantic selection. */
import { createElement as h, useSyncExternalStore } from 'react';
import { inspectionState, subscribeInspection } from './foundry-inspection-store.mjs';
import './foundry-inspection.css';

const row = (label, value, field) => h('div', { key: field },
  h('dt', null, label), h('dd', { 'data-field': field }, String(value)));
const meta = rows => h('dl', { className: 'project-meta' }, ...rows);

export function FoundryInspection({ machineId, assetId, bindingStatus, stepHash, irHash }) {
  const { map, sceneId, frame, freshness } = useSyncExternalStore(subscribeInspection, inspectionState);
  if (!map || new URL(window.location.href).searchParams.get('localSceneId') !== sceneId) return null;
  const source = map.machines.find(m => m.machine_id === machineId);
  if (!source) return null;
  const verified = bindingStatus === 'resolved' && source.asset_id === assetId &&
    source.artifacts.find(a => a.kind === 'step').sha256 === stepHash &&
    source.artifacts.find(a => a.kind === 'mechanical-ir').sha256 === irHash;
  const snapshot = frame?.snapshot;
  const task = snapshot?.machines.find(m => m.machine_id === machineId);
  const children = [h('h4', { key: 'title' }, 'Foundry runtime'),
    h('strong', { key: 'provenance' }, 'origin: simulated · validity: modeled'),
    h('p', { key: 'freshness', role: 'status' }, !frame ? 'Awaiting committed state' :
      freshness === 'fresh' ? 'Current committed state · transport verified' : 'STALE — last-known values; controller freshness unverified')];
  if (!verified) children.push(h('p', { key: 'mismatch', role: 'alert' }, 'Runtime unavailable: engineering/scene binding mismatch.'));
  else if (snapshot) {
    children.push(h('div', { key: 'identity' }, meta([
      row('Runtime machine', machineId, 'machine-id'),
      row('Committed revision', snapshot.revision, 'revision'),
      row('Simulation time', `${snapshot.simulation_time_ms} ms`, 'time'),
    ])));
    if (!task) children.push(h('p', { key: 'unimplemented', 'data-executable': 'false' },
      'Not executable — process model and telemetry not implemented. No production, power or temperature reading available.'));
    else {
      const transition = task.last_transition;
      children.push(h('div', { key: 'task' }, meta([
        row('Job', task.id, 'job'), row('State', task.scheduled ? task.status : 'not started', 'status'),
        row('Phase', task.phase_id ?? 'unavailable (no active phase)', 'phase'),
        row('Blocked / failure reason', task.reason ?? 'none', 'reason'),
        row('Successful work', `${task.completed_steps} steps · ${task.phase_work_ms} ms`, 'work'),
        row('Last task checkpoint', task.updated_at_ms === null ? 'not scheduled' : `${task.updated_at_ms} ms`, 'updated'),
        row('Last task transition', transition ?
          `${transition.from ?? 'not scheduled'} → ${transition.to}; ${transition.action}; revision ${transition.revision} @ ${transition.at_ms} ms${transition.reason ? '; ' + transition.reason : ''}` :
          'unavailable (not started or predates transition recording)', 'transition'),
      ])));
      const accountIds = task.id === 'regolith-delivery' ? ['site', 'transit', 'hopper'] : ['hopper', 'preheater'];
      children.push(h('h4', { key: 'material-title' }, 'Material ledger'), h('div', { key: 'material' }, meta(snapshot.material.accounts
        .filter(a => accountIds.includes(a.account_id)).map(a => row(a.account_id,
          `${a.quantity_g} g · lot ${a.lot_id}${a.capacity_g === null ? '' : ` · capacity ${a.capacity_g} g`}`, `mass-${a.account_id}`)))));
      if (task.id === 'hopper-to-preheater') children.push(h('p', { key: 'feed' },
        `${snapshot.material.feed_g_per_step} g / settled feed step; feeder is pass-through with no separate stock.`));
      if (task.id === 'preheat-regolith') {
        const t = snapshot.thermal;
        children.push(h('h4', { key: 'thermal-title' }, 'Electrical / thermal model'), h('div', { key: 'thermal' }, meta([
          row('Heater request ceiling', `${snapshot.power.requested_limit_w} W`, 'requested-power'),
          row('Available power limit', `${snapshot.power.available_limit_w} W`, 'power-limit'),
          row('Last recorded applied power (not live demand)', `${t.last_applied_power_w} W`, 'last-power'),
          row('Electrical spend', `${snapshot.energy_mJ.spent} mJ`, 'spent'),
          row('Remaining electrical energy', `${snapshot.energy_mJ.available} mJ`, 'available-energy'),
          row('Calculated temperature', `${t.temperature_mK} mK (${(t.temperature_mK / 1000).toFixed(3)} K)`, 'temperature'),
          row('Target temperature', `${t.target_temperature_mK} mK`, 'target'),
          row('Thermal input', `${t.input_energy_mJ} mJ`, 'heat-input'),
          row('Cumulative thermal loss', `${t.lost_energy_mJ} mJ`, 'heat-loss'),
          row('Rounding residual', `${t.numerical_residual_mJ} mJ`, 'residual'),
          row('Release ready', String(t.output_ready), 'ready'),
        ])), h('small', { key: 'thermal-note' }, 'Lumped preheat model; heat is evaluated on successful task steps. Blocked/paused steps do not model passive cooling.'));
      } else children.push(h('p', { key: 'no-power' }, 'Machine electrical demand and temperature: unavailable; not modeled for this task.'));
    }
  }
  children.push(h('details', { key: 'sources' }, h('summary', null, 'Verified engineering sources'),
    ...source.artifacts.map(a => h('p', { key: a.kind },
      h('a', { href: a.url, download: '', 'data-artifact': a.kind }, a.path),
      h('small', null, 'SHA-256: ', h('code', null, a.sha256)))),
    h('p', null, 'Resolved identifies CAD geometry and source bytes; it does not certify performance, plumbing, thermal physics or flight qualification.')));
  return h('section', { 'aria-label': 'Foundry runtime inspection', 'data-machine-id': machineId,
    'data-runtime-revision': snapshot?.revision ?? '', 'data-freshness': freshness,
    style: { borderTop: '1px solid #566070', marginTop: 12, paddingTop: 8, overflowWrap: 'anywhere' } }, ...children);
}
