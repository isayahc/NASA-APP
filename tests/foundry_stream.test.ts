/** Tests use a REAL local OI SQLite controller and native HTTP SSE transport. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as rawHttpRequest } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FoundryDatabase } from "../integrations/openindustries/foundry-runtime.ts";
import { FoundrySseBridge, frameId, makeFrame } from "../integrations/openindustries/foundry-sse.ts";
import { acceptFrame } from "../integrations/openindustries/foundry-browser-stream.mjs";

const SCENE = "11111111-1111-4111-8111-111111111111";
const INSTANCE = "f1-live";
const TEST_PASSWORD = "only-in-local-integration-tests";
const input = JSON.parse(readFileSync(
  fileURLToPath(new URL("../scenarios/lunar-south-pole/first-transfer.json", import.meta.url)),
  "utf8",
));

async function fixture() {
  /** Construct an authenticated OI domain without mocks or synthetic events. */
  const directory = mkdtempSync(join(tmpdir(), "nasa-f1-"));
  const db = new FoundryDatabase(join(directory, "factory.sqlite"));
  const session = await db.authenticate({
    username: "local-founder", password: TEST_PASSWORD,
  }, true);
  const token = session.token;
  db.create(token, INSTANCE, input);
  const stream = new FoundrySseBridge({ read: () => db.read(token, INSTANCE) }, {
    oiSceneId: SCENE, instanceId: INSTANCE, pollMs: 50, heartbeatMs: 1000,
  });
  await stream.start();
  const server = createServer((req, res) => {
    void stream.handle(req, res).then((handled) => {
      if (!handled) { res.statusCode = 404; res.end(); }
    }).catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  const execute = (action: string, previous: number) =>
    db.execute(token, {
      command_id: "test-" + action + "-" + previous,
      instance_id: INSTANCE, expected_revision: previous,
      action, payload: {},
    }).snapshot;
  const close = async () => {
    stream.close();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { db, token, stream, base, execute, close };
}

async function firstSnapshotEvent(response: Response): Promise<{ id: string; data: unknown }> {
  /** Read one complete SSE snapshot, tolerating chunking and heartbeat blocks. */
  assert(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let partial = "";
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const next = await reader.read();
    if (next.done) throw Error("SSE stream ended before a snapshot");
    partial += decoder.decode(next.value, { stream: true }).replaceAll("\r", "");
    while (partial.includes("\n\n")) {
      const index = partial.indexOf("\n\n");
      const block = partial.slice(0, index);
      partial = partial.slice(index + 2);
      if (!block.includes("event: snapshot")) continue;
      const id = block.split("\n").find((line) => line.startsWith("id: "))?.slice(4);
      const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      assert(id && data);
      void reader.cancel().catch(() => {});
      return { id, data: JSON.parse(data) };
    }
  }
  throw Error("SSE snapshot timed out");
}

test("real initial state is read-only and new committed revisions advance SSE", async () => {
  const h = await fixture();
  try {
    const before = await fetch(h.base + "/api/foundry/snapshot");
    assert.equal(before.status, 200);
    const current = await before.json();
    assert.equal(current.revision, 1);
    assert.equal(current.snapshot.inventory_g.site, 10000);
    const response = await fetch(h.base + "/api/foundry/events");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const event = await firstSnapshotEvent(response);
    assert.equal(event.id, "f1-live:1");
    assert.deepEqual(event.data, current);
    const next = h.execute("start", 1);
    await h.stream.refresh();
    assert.equal(h.stream.current()?.revision, next.revision);
    assert.equal((await (await fetch(h.base + "/api/foundry/snapshot")).json()).revision, 2);
    assert.equal(h.db.read(h.token, INSTANCE).simulation_time_ms, 0);
  } finally { await h.close(); }
});

test("Last-Event-ID recovers only unseen committed head; no duplicate or fabricated step", async () => {
  const h = await fixture();
  try {
    const started = h.execute("start", 1);
    const stepped = h.execute("step", started.revision);
    await h.stream.refresh();
    const response = await fetch(h.base + "/api/foundry/events", {
      headers: { "Last-Event-ID": "f1-live:1" },
    });
    const event = await firstSnapshotEvent(response);
    assert.equal(event.id, "f1-live:3");
    assert.equal(event.data.snapshot.simulation_time_ms, 1000);
    assert.equal(event.data.snapshot.inventory_g.transit, 1000);
    assert.equal(event.data.snapshot.inventory_g.hopper, 0);
    // Reconnect to an unchanged revision should not produce a new frame.
    const recent = h.stream.current();
    await h.stream.refresh();
    assert.deepEqual(h.stream.current(), recent);
    const next = h.execute("step", stepped.revision);
    await h.stream.refresh();
    assert.equal(h.stream.current()?.revision, next.revision);
  } finally { await h.close(); }
});

test("browser reducer rejects old, mismatched, tampered, and duplicate frames", async () => {
  const h = await fixture();
  try {
    const a = makeFrame(h.db.read(h.token, INSTANCE));
    assert.equal(acceptFrame(null, a)?.revision, 1);
    assert.equal(frameId(a), "f1-live:1");
    assert.equal(acceptFrame(a, a), null);
    const wrong = structuredClone(a);
    wrong.instance_id = "different-factory";
    assert.equal(acceptFrame(a, wrong), null);
    const bad = structuredClone(a);
    bad.snapshot.mass_conserved = false;
    assert.equal(acceptFrame(null, bad), null);
    const state = h.execute("start", a.revision);
    const b = makeFrame(state);
    assert.equal(acceptFrame(a, b)?.revision, 2);
    assert.equal(acceptFrame(b, a), null);
    assert.equal(acceptFrame(null, b, "wrong-scene"), null);
    const corruptClock = structuredClone(b);
    corruptClock.simulation_time_ms = -1;
    assert.equal(acceptFrame(b, corruptClock), null);
  } finally { await h.close(); }
});

test("cross-origin, remote Host, and writes are rejected without touching authority", async () => {
  const h = await fixture();
  try {
    const initial = h.db.read(h.token, INSTANCE);
    const origin = await fetch(h.base + "/api/foundry/snapshot", {
      headers: { Origin: "http://attacker.example" },
    });
    assert.equal(origin.status, 403);
    const remoteStatus = await new Promise<number>((done, reject) => {
      const request = rawHttpRequest(h.base + "/api/foundry/config", {
        headers: { Host: "attacker.example" },
      }, (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(remoteStatus, 403);
    const mutation = await fetch(h.base + "/api/foundry/snapshot", { method: "POST" });
    assert.equal(mutation.status, 403);
    const config = await (await fetch(h.base + "/api/foundry/config")).json();
    assert.equal(config.oi_scene_id, SCENE);
    assert.equal(config.read_only, true);
    assert.equal(h.db.read(h.token, INSTANCE).revision, initial.revision);
  } finally { await h.close(); }
});

test("invalid backend projection fails closed and never broadcasts a false revision", async () => {
  const h = await fixture();
  try {
    const before = h.stream.current();
    const original = h.db.read.bind(h.db);
    // Replay an independently manipulated snapshot through a separate
    // stream, rather than corrupting the authoritative SQLite DB.
    const bad = new FoundrySseBridge({
      read: () => ({ ...original(h.token, INSTANCE), mass_conserved: false }),
    }, { oiSceneId: SCENE, instanceId: INSTANCE });
    await assert.rejects(bad.start(), /INVALID_AUTHORITY_SNAPSHOT/);
    assert.deepEqual(h.stream.current(), before);
    bad.close();
  } finally { await h.close(); }
});
