/** Validate/project read-only material presentation. Integer grams, no render clock. */
export const ACCOUNTS = ['site', 'transit', 'hopper', 'preheater'];
export const LABELS = { site: 'Site stock', transit: 'Excavator cargo', hopper: 'Hopper', preheater: 'Preheater WIP' };
const whole = n => Number.isSafeInteger(n) && n >= 0;
const requireValue = (condition, message) => { if (!condition) throw Error('INVALID_MATERIAL: ' + message); };

export function materialView(snapshot, previous = null) {
  const m = snapshot.material;
  requireValue(m && typeof m.lot?.id === 'string' && m.lot.id.length > 0 &&
    typeof m.lot.provenance === 'string' && typeof m.lot.composition?.source === 'string' &&
    typeof m.lot.composition.remainder === 'string' &&
    Number.isFinite(m.lot.composition.oxygen_bearing_oxide_mass_fraction) &&
    m.lot.composition.oxygen_bearing_oxide_mass_fraction >= 0 &&
    m.lot.composition.oxygen_bearing_oxide_mass_fraction <= 1, 'lot identity/composition');
  requireValue(whole(m.total_g) && whole(m.ledger_sequence) && whole(m.feed_g_per_step) && m.feed_g_per_step > 0,
    'totals/ledger sequence/feed quantum');
  requireValue(Array.isArray(m.postings), 'posting tail');
  requireValue(Array.isArray(m.accounts) && m.accounts.length === 4, 'four ledger accounts required');
  const accounts = ACCOUNTS.map(id => {
    const rows = m.accounts.filter(a => a.account_id === id), a = rows[0];
    requireValue(rows.length === 1 && a.lot_id === m.lot.id && whole(a.quantity_g) &&
      a.quantity_g === snapshot.inventory_g[id] &&
      (a.capacity_g === null || (whole(a.capacity_g) && a.quantity_g <= a.capacity_g)) &&
      (a.owner_id === null || typeof a.owner_id === 'string'), 'account ' + id);
    return { ...a, label: LABELS[id], state: a.quantity_g === 0 ? 'empty' :
      a.capacity_g !== null && a.quantity_g === a.capacity_g ? 'full' : 'occupied' };
  });
  requireValue(accounts.reduce((sum, a) => sum + a.quantity_g, 0) === m.total_g && snapshot.mass_conserved === true,
    'conservation');
  if (previous) requireValue(m.lot.id === previous.material.lot.id && snapshot.model_sha256 === previous.model_sha256 &&
    JSON.stringify(m.lot) === JSON.stringify(previous.material.lot) && m.total_g === previous.material.total_g &&
    m.ledger_sequence >= previous.material.ledger_sequence, 'regressed or changed material identity');
  const seen = new Set();
  let sequence = -1;
  const transfers = m.postings.map(entry => {
    requireValue(typeof entry.id === 'string' && !seen.has(entry.id) && whole(entry.sequence) &&
      entry.sequence > sequence && entry.sequence <= m.ledger_sequence && whole(entry.at_ms) &&
      entry.at_ms <= snapshot.simulation_time_ms && entry.postings.length === 2, 'posting identity/order');
    seen.add(entry.id); sequence = entry.sequence;
    requireValue(entry.postings.every(p => ACCOUNTS.includes(p.account_id) && p.lot_id === m.lot.id &&
      p.resource_id === 'regolith' && p.unit === 'g' && Number.isSafeInteger(p.delta)), 'posting units/lot');
    const debit = entry.postings.find(p => p.delta < 0), credit = entry.postings.find(p => p.delta > 0);
    requireValue(debit && credit && debit.delta + credit.delta === 0, 'unbalanced posting');
    const route = `${debit.account_id}:${credit.account_id}`;
    const task = route === 'hopper:preheater' ? 'hopper-to-preheater' : 'regolith-delivery';
    requireValue(['site:transit', 'transit:hopper', 'hopper:preheater', 'transit:site'].includes(route) &&
      entry.job_ids.length === 1 && entry.job_ids[0] === task, 'unsupported transfer route/task');
    if (route === 'hopper:preheater') requireValue(credit.delta === m.feed_g_per_step, 'feed quantum');
    return { id: entry.id, sequence: entry.sequence, at_ms: entry.at_ms,
      source: debit.account_id, destination: credit.account_id, mass_g: credit.delta, job_id: task };
  });
  const feeder = snapshot.machines.find(j => j.id === 'hopper-to-preheater');
  const delivery = snapshot.machines.find(j => j.id === 'regolith-delivery');
  requireValue(feeder && delivery, 'missing material tasks');
  return { lot: m.lot, total_g: m.total_g, accounts, transfers,
    feed_g_per_step: m.feed_g_per_step, feeder, delivery, ledger_sequence: m.ledger_sequence };
}
