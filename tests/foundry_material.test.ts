/** Material presentation is checked against real OI SQLite balances and postings. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { materialView } from '../integrations/openindustries/foundry-material.mjs';
import { buildMaterialMap } from '../integrations/openindustries/foundry-material-map.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const scenario = JSON.parse(readFileSync(join(ROOT, 'scenarios/lunar-south-pole/first-transfer.json'), 'utf8'));
async function fixture(input = scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'nasa-f4-')), db = new FoundryDatabase(join(dir, 'material.sqlite'));
  const { token } = await db.authenticate({ username: 'materials-test', password: 'local-test-material-ledger' }, true);
  let snapshot = db.create(token, 'f4', input), n = 0;
  return { db, token, get snapshot() { return snapshot; },
    command(action: string, payload = {}) {
      const previous = snapshot;
      snapshot = db.execute(token, { instance_id: 'f4', command_id: `f4-${n++}`,
        expected_revision: snapshot.revision, action, payload }).snapshot;
      materialView(snapshot, previous);
      return snapshot;
    },
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
function verify(h: Awaited<ReturnType<typeof fixture>>) {
  const state = h.db.load('f4'), view = materialView(h.snapshot);
  const ledger = state.schedule.domain.resources as any;
  for (const account of view.accounts) {
    const quantity = ledger.balances.filter((b: any) => b.account_id === account.account_id &&
      b.lot_id === scenario.lot.id && b.unit === 'g').reduce((sum: number, b: any) => sum + b.quantity, 0);
    assert.equal(account.quantity_g, quantity);
    assert.equal(account.capacity_g, ledger.accounts.find((a: any) => a.id === account.account_id).capacity);
    assert.equal(account.owner_id, ledger.accounts.find((a: any) => a.id === account.account_id).owner_id);
  }
  for (const transfer of view.transfers) {
    const entry = ledger.entries.find((e: any) => e.context.id === transfer.id);
    assert(entry);
    assert(entry.postings.some((p: any) => p.account_id === transfer.source && p.delta === -transfer.mass_g));
    assert(entry.postings.some((p: any) => p.account_id === transfer.destination && p.delta === transfer.mass_g));
  }
  return view;
}

test('1000g remains cargo until settled delivery; five 200g feed postings conserve the same lot', async () => {
  const h = await fixture();
  try {
    assert.equal(verify(h).lot.id, 'regolith-0001');
    h.command('start');
    for (let i = 0; i < 3; i++) {
      h.command('step'); verify(h);
      assert.equal(h.snapshot.inventory_g.hopper, 0);
      assert.equal(h.snapshot.inventory_g.transit, 1000);
    }
    h.command('step'); verify(h);
    assert.equal(h.snapshot.inventory_g.hopper, 1000);
    assert.equal(h.snapshot.inventory_g.transit, 0);
    for (let i = 1; i <= 5; i++) {
      h.command('step'); const view = verify(h);
      assert.equal(h.snapshot.inventory_g.hopper, 1000 - i * 200);
      assert.equal(h.snapshot.inventory_g.preheater, i * 200);
      assert.equal(view.transfers.at(-1).mass_g, 200);
      assert.equal(view.transfers.filter((t: any) => t.source === 'hopper').length, i);
    }
    assert.deepEqual(h.snapshot.material.lot, scenario.lot);
    assert.equal(verify(h).total_g, 10000);
    assert.deepEqual(h.db.replay(h.token, 'f4'), h.snapshot);
    const saved = h.db.read(h.token, 'f4'); materialView(saved);
    assert.deepEqual(h.db.read(h.token, 'f4'), saved);
  } finally { h.close(); }
});

test('pause, full hopper, empty source, blocked feeder and cancel never fabricate or discard stock', async () => {
  for (const mode of ['pause', 'full', 'empty', 'blocked', 'cancel']) {
    const input = structuredClone(scenario);
    if (mode === 'full') input.opening.hopper_regolith_g = input.constraints.hopper_capacity_g;
    if (mode === 'empty') input.opening.source_regolith_g = 0;
    const h = await fixture(input);
    try {
      h.command('start'); h.command('step');
      if (mode === 'pause') h.command('pause', { job_id: 'regolith-delivery' });
      if (mode === 'blocked') {
        for (let i = 0; i < 3; i++) h.command('step');
        h.command('set-feeder-blocked', { blocked: true });
      }
      if (mode === 'cancel') {
        h.command('cancel', { job_id: 'regolith-delivery' });
        assert.equal(h.snapshot.inventory_g.site, 10000);
        assert.equal(verify(h).transfers.at(-1).destination, 'site');
      }
      const before = h.snapshot.material;
      for (let i = 0; i < 6; i++) { h.command('step'); verify(h); }
      assert.deepEqual(h.snapshot.material.accounts, before.accounts, mode);
      assert.deepEqual(h.snapshot.material.postings, before.postings, mode);
      if (mode === 'full') assert.equal(verify(h).accounts.find((a: any) => a.account_id === 'hopper').state, 'full');
      if (mode === 'empty') assert.equal(verify(h).accounts.find((a: any) => a.account_id === 'site').state, 'empty');
    } finally { h.close(); }
  }
});

test('material validator rejects changed lot, invented balances, mismatched credits and capacity overflow', async () => {
  const h = await fixture();
  try {
    h.command('start'); h.command('step');
    const original = h.snapshot;
    for (const corrupt of [
      (s: any) => { s.material.accounts[1].quantity_g++; },
      (s: any) => { s.material.accounts[1].capacity_g = 1; },
      (s: any) => { s.material.postings[0].postings[0].delta++; },
      (s: any) => { s.material.postings[0].postings[0].lot_id = 'invented'; },
      (s: any) => { s.material.total_g++; },
    ]) {
      const bad = structuredClone(original); corrupt(bad);
      assert.throws(() => materialView(bad, original), /INVALID_MATERIAL/);
    }
  } finally { h.close(); }
});

test('#4 port map uses exact declared inlet/outlet coordinates and rejects altered placement', async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.generated/lunar-foundry.oi.json'), 'utf8'));
  const graph = JSON.parse(readFileSync(join(ROOT, '.generated/lunar-foundry.connections.json'), 'utf8'));
  const map = await buildMaterialMap(ROOT, manifest);
  assert.equal(map.routes.length, 2);
  for (const station of map.stations)
    assert.deepEqual(station.ports, graph.stations.find((s: any) => s.id === station.machine_id).ports);
  manifest.instances[0].position[0]++;
  await assert.rejects(buildMaterialMap(ROOT, manifest), /MATERIAL_LAYOUT_MISMATCH/);
});
