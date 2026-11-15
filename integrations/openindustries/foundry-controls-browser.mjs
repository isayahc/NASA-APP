/** Operator commands inside the existing OI inspector; all values read back through F1. */
import { createElement as h, useState, useSyncExternalStore } from 'react';
import { inspectionState, subscribeInspection } from './foundry-inspection-store.mjs';

export function FoundryControlsPanel() {
  const { frame, freshness, sceneId } = useSyncExternalStore(subscribeInspection, inspectionState);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  if (!frame || new URL(location.href).searchParams.get('localSceneId') !== sceneId) return null;
  const s = frame.snapshot, c = s.controls;
  const finished = s.machines.every(m => ['completed', 'failed', 'cancelled'].includes(m.status));
  const disabled = pending || freshness !== 'fresh';
  async function send(action, payload = {}) {
    setPending(true); setError('');
    try {
      const response = await fetch('/api/foundry/commands', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Foundry-Command': '1' },
        body: JSON.stringify({ command_id: crypto.randomUUID(), instance_id: s.instance_id,
          expected_revision: s.revision, action, payload }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? 'Command rejected');
      // Never use a command response as telemetry. F1 publishes the committed head.
      if (result.snapshot.controls.successor_id) location.reload();
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  }
  const button = (label, action, invalid) => h('button', { key: action, disabled: disabled || invalid,
    onClick: () => send(action) }, label);
  return h('section', { 'aria-label': 'Foundry controls', 'data-runtime-revision': s.revision, 'data-run-id': s.instance_id },
    h('h3', null, 'Foundry controls'),
    h('p', null, `SIMULATED · ${c.running ? 'Running' : 'Paused / manual'} · revision ${s.revision} · ${s.simulation_time_ms} ms`),
    h('small', null, `Run: ${s.instance_id}`),
    h('div', { className: 'capture-actions' },
      button('Start', 'start', c.started), button('Step', 'step', !c.started || c.running || finished),
      button('Pause', 'pause-plant', !c.running), button('Resume', 'resume-plant', !c.started || c.running || finished),
      button('Reset — new run', 'reset', c.running)),
    h('label', null, 'Simulation speed', h('select', { 'aria-label': 'Simulation speed', value: c.speed,
      disabled, onChange: e => send('set-speed', { speed: Number(e.target.value) }) },
      ...[0.25, 1, 2, 4].map(speed => h('option', { key: speed, value: speed }, `${speed}×`)))),
    h('small', null, 'Start queues once. Step pays one quantum. Resume starts the server clock; Pause permits manual steps. Reset preserves this run.'),
    h('details', null, h('summary', null, 'Operating constraints'),
      h('button', { disabled, onClick: () => send('set-feeder-blocked', { blocked: true }) }, 'Block feeder'),
      h('button', { disabled, onClick: () => send('set-feeder-blocked', { blocked: false }) }, 'Unblock feeder'),
      h('button', { disabled, onClick: () => send('set-power', { limit_w: 0 }) }, 'Cut heater power'),
      h('button', { disabled, onClick: () => send('set-power', { limit_w: s.power.requested_limit_w }) }, 'Restore heater power')),
    h('p', { role: 'status' }, pending ? 'Submitting command; waiting for committed state…' :
      freshness !== 'fresh' ? 'STALE — controls disabled until authority reconnects' : 'Authoritative controls ready'),
    error && h('p', { role: 'alert' }, error));
}
