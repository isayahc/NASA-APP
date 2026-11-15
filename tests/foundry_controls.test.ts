/** Actual local HTTP commands, native OI receipts, reset lineage and clock lease. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FoundryDatabase } from '../integrations/openindustries/foundry-runtime.ts';
import { FoundryControls } from '../integrations/openindustries/foundry-controls.ts';
import { FoundrySseBridge } from '../integrations/openindustries/foundry-sse.ts';

const scenario = JSON.parse(readFileSync(fileURLToPath(new URL('../scenarios/lunar-south-pole/first-transfer.json', import.meta.url)), 'utf8'));
async function fixture(now = Date.now) {
  const directory = mkdtempSync(join(tmpdir(), 'nasa-controls-')), path = join(directory, 'state.sqlite'), db = new FoundryDatabase(path);
  const { token } = await db.authenticate({ username: 'test-operator', password: 'test-local-controls-only' }, true);
  db.create(token, 'root', scenario);
  let active = 'root', bridge: FoundrySseBridge;
  const controls = new FoundryControls(db, token, 'root', async () => {
    active = controls.active(); bridge.selectInstance(active); await bridge.refresh();
  }, now);
  controls.initialize();
  bridge = new FoundrySseBridge({ read: () => db.read(token, active) }, {
    instanceId: active, oiSceneId: '11111111-1111-4111-8111-111111111111', pollMs: 50,
  });
  await bridge.start();
  const server = createServer(async (req, res) => {
    if (await controls.handle(req, res)) return;
    controls.observeStream(req, res);
    if (!await bridge.handle(req, res)) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  const session = await fetch(base + '/api/foundry/control-session');
  const cookie = session.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0], Origin: base, 'X-Foundry-Command': '1', 'Content-Type': 'application/json' };
  const snapshot = () => db.read(token, controls.active());
  let sequence = 0;
  const request = (action: string, payload = {}) => ({ instance_id: snapshot().instance_id,
    command_id: 'command-' + sequence++, expected_revision: snapshot().revision, action, payload });
  const post = (body: any, override = {}) => fetch(base + '/api/foundry/commands', {
    method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify(body),
  });
  return { db, path, token, base, headers, bridge, controls, snapshot, request, post,
    async close() { controls.close(); bridge.close(); server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done())); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('HTTP commands enforce credentials, origin, revisions, types and native duplicate receipts', async () => {
  const h = await fixture();
  try {
    const initial = h.snapshot(), start = h.request('start');
    assert.equal((await h.post(start, { Cookie: '' })).status, 401);
    assert.equal((await h.post(start, { Origin: 'http://other.example' })).status, 403);
    assert.equal((await h.post(start, { 'X-Foundry-Command': '' })).status, 403);
    assert.deepEqual(h.snapshot(), initial);
    assert.equal((await fetch(h.base + '/api/foundry/control-session', {
      method: 'POST', headers: h.headers, body: JSON.stringify(start),
    })).status, 403);
    const first = await (await h.post(start)).json();
    assert.deepEqual(await (await h.post(start)).json(), first);
    assert.equal((await h.post({ ...start, action: 'step' })).status, 409);
    assert.equal((await h.post({ ...h.request('step'), expected_revision: 1 })).status, 409);
    for (const speed of [0, 3, 100, '4', null]) assert.equal((await h.post(h.request('set-speed', { speed }))).status, 400);
    assert.equal((await h.post(h.request('clock-step'))).status, 400);
    assert.equal((await h.post(h.request('resume-plant'))).status, 400, 'no stream cannot run a clock');
    const step = await (await h.post(h.request('step'))).json();
    assert.equal(step.snapshot.simulation_time_ms, 1000);
    assert.equal(step.snapshot.revision, 3);
    assert.deepEqual(h.snapshot(), step.snapshot);
  } finally { await h.close(); }
});

test('reset is atomic/idempotent, preserves old replay, and follows durable explicit lineage', async () => {
  const h = await fixture();
  try {
    await h.post(h.request('start')); await h.post(h.request('step'));
    const before = h.snapshot(), reset = h.request('reset');
    const result = await (await h.post(reset)).json(), fresh = h.snapshot();
    assert.notEqual(fresh.instance_id, before.instance_id);
    assert.equal(fresh.revision, 1); assert.equal(fresh.simulation_time_ms, 0);
    assert.equal(fresh.inventory_g.site, scenario.opening.source_regolith_g);
    const archived = h.db.replay(h.token, 'root');
    assert.equal(archived.controls.successor_id, fresh.instance_id);
    assert.deepEqual(archived.inventory_g, before.inventory_g);
    assert.deepEqual(await (await h.post(reset)).json(), result);
    assert.deepEqual(h.snapshot(), fresh);
    assert.deepEqual(h.db.lineage(h.token, 'root'), ['root', fresh.instance_id]);
    assert.equal((await h.post({ ...h.request('step'), instance_id: 'root', expected_revision: archived.revision })).status, 400);
    assert.deepEqual(h.db.replay(h.token, fresh.instance_id), fresh);
    const reopened = new FoundryDatabase(h.path);
    try { assert.equal(reopened.lineage(h.token, 'root').at(-1), fresh.instance_id); }
    finally { reopened.close(); }
  } finally { await h.close(); }
});

test('reset rolls back archival and receipt when successor creation fails', async () => {
  const h = await fixture();
  try {
    const reset = h.request('reset'), before = h.snapshot();
    const collision = 'run-' + createHash('sha256').update('root:' + reset.command_id).digest('hex').slice(0, 32);
    h.db.create(h.token, collision, scenario);
    assert.equal((await h.post(reset)).status, 400);
    assert.deepEqual(h.snapshot(), before);
    assert.deepEqual(h.db.replay(h.token, 'root'), before);
    assert.equal(h.db.db.prepare('SELECT count(*) n FROM nasa_foundry_receipts').get()!.n, 0);
  } finally { await h.close(); }
});

test('expired browser lease and server restart stop scheduling without catch-up work', async () => {
  let wall = Date.now();
  const h = await fixture(() => wall), abort = new AbortController();
  try {
    const response = await fetch(h.base + '/api/foundry/events', { headers: { Cookie: h.headers.Cookie }, signal: abort.signal });
    await response.body!.getReader().read();
    await h.post(h.request('start')); await h.post(h.request('set-speed', { speed: 4 }));
    await h.post(h.request('resume-plant'));
    wall += 3000;
    const deadline = Date.now() + 3000;
    while (h.snapshot().controls.running && Date.now() < deadline) await new Promise(done => setTimeout(done, 20));
    assert.equal(h.snapshot().controls.running, false);
    assert.equal(h.snapshot().simulation_time_ms, 0);
    await h.post(h.request('resume-plant'));
    assert.equal(h.snapshot().controls.running, true);
    h.controls.initialize();
    assert.equal(h.snapshot().controls.running, false);
    assert.equal(h.snapshot().simulation_time_ms, 0);
  } finally { abort.abort(); await h.close(); }
});

test('server clock pays fixed quanta at bounded speed and stream closure pauses authoritatively', async () => {
  const h = await fixture(), abort = new AbortController();
  try {
    const response = await fetch(h.base + '/api/foundry/events', { headers: { Cookie: h.headers.Cookie }, signal: abort.signal });
    await response.body!.getReader().read();
    await h.post(h.request('start'));
    await h.post(h.request('set-speed', { speed: 4 }));
    await h.post(h.request('resume-plant'));
    const deadline = Date.now() + 3000;
    while (h.snapshot().simulation_time_ms < 1000 && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    assert(h.snapshot().simulation_time_ms >= 1000);
    abort.abort();
    while (h.snapshot().controls.running && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    const paused = h.snapshot(); assert.equal(paused.controls.running, false);
    await new Promise(done => setTimeout(done, 550));
    assert.deepEqual(h.snapshot(), paused);
    assert.equal(paused.simulation_time_ms % 1000, 0);
  } finally { abort.abort(); await h.close(); }
});
