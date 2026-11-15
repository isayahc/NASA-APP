/**
 * Read-only SSE over real committed NASA-APP / OpenIndustries state.
 *
 * No simulation ticks or scene edits are performed by this transport.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FoundrySnapshot } from "./foundry-runtime.ts";

export const STREAM_PROTOCOL = "nasa.foundry.snapshot.v1" as const;

export interface FoundryStreamFrame {
  protocol: typeof STREAM_PROTOCOL;
  instance_id: string;
  scene_id: string;
  revision: number;
  simulation_time_ms: number;
  origin: "simulated";
  validity: "modeled";
  snapshot: FoundrySnapshot;
}

export interface SnapshotReader {
  /** Read a validated projection from the persisted OI authority. */
  read(): FoundrySnapshot | Promise<FoundrySnapshot>;
}

interface Subscriber {
  response: ServerResponse;
  instanceId: string | null;
  revision: number;
}

export function makeFrame(snapshot: FoundrySnapshot): FoundryStreamFrame {
  /** Reject invalid, unauthorized-looking or unbalanced projections. */
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 1 || !Number.isSafeInteger(snapshot.simulation_time_ms) ||
      snapshot.simulation_time_ms < 0 || !snapshot.mass_conserved ||
      !snapshot.energy_conserved || snapshot.provenance.origin !== "simulated" ||
      snapshot.provenance.validity !== "modeled" ||
      !snapshot.instance_id || snapshot.scene_id !== "lunar-foundry-mvp") {
    throw Error("INVALID_AUTHORITY_SNAPSHOT");
  }
  return {
    protocol: STREAM_PROTOCOL, instance_id: snapshot.instance_id,
    scene_id: snapshot.scene_id, revision: snapshot.revision,
    simulation_time_ms: snapshot.simulation_time_ms,
    origin: "simulated", validity: "modeled", snapshot,
  };
}

export function frameId(frame: FoundryStreamFrame): string {
  /** Stable, instance-scoped Last-Event-ID; never an auth secret. */
  return frame.instance_id + ":" + frame.revision;
}

function isLocal(req: IncomingMessage): boolean {
  /** Enforce browser same-origin and loopback Host, preventing cross-site reads. */
  const host = req.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1):\d{2,5}$/.test(host)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    try {
      if (new URL(origin).origin !== "http://" + host) return false;
    } catch { return false; }
  }
  return true;
}

/** Purely read-only SSE multiplexing over a pinned single foundry runtime. */
export class FoundrySseBridge {
  private readonly subscribers = new Set<Subscriber>();
  private latest: FoundryStreamFrame | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly reader: SnapshotReader,
    private readonly options: {
      oiSceneId: string;
      instanceId: string;
      pollMs?: number;
      heartbeatMs?: number;
    },
  ) {
    if (!/^[a-f0-9-]{36}$/i.test(options.oiSceneId) ||
        !/^[a-zA-Z0-9_.:-]{1,128}$/.test(options.instanceId))
      throw Error("INVALID_SCENE_OR_INSTANCE_ID");
    if (options.pollMs !== undefined &&
        (!Number.isSafeInteger(options.pollMs) || options.pollMs < 50))
      throw Error("INVALID_STREAM_POLL");
  }

  /** Confirm a valid committed snapshot before the transport opens. */
  async start(): Promise<void> {
    if (this.timer || this.stopped) throw Error("STREAM_ALREADY_STARTED");
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); },
      this.options.pollMs ?? 200);
    this.timer.unref?.();
    this.keepalive = setInterval(() => {
      for (const client of this.subscribers)
        if (!client.response.destroyed && !client.response.writableEnded)
          client.response.write(": keepalive\n\n");
    }, this.options.heartbeatMs ?? 15000);
    this.keepalive.unref?.();
  }

  /** Return last verified state; this is a snapshot, not a live scene revision. */
  current(): FoundryStreamFrame | null { return this.latest; }

  /** Re-read the real SQLite controller, broadcasting only monotonic revisions. */
  async refresh(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const next = makeFrame(await this.reader.read());
      if (next.instance_id !== this.options.instanceId) throw Error("WRONG_INSTANCE");
      if (this.latest && (next.revision < this.latest.revision ||
          next.simulation_time_ms < this.latest.simulation_time_ms))
        throw Error("AUTHORITATIVE_STATE_REGRESSED");
      if (!this.latest || next.revision > this.latest.revision) {
        this.latest = next;
        for (const client of this.subscribers) this.send(client, next);
      }
    } catch (error) {
      // A backend failure never becomes a fictitious new snapshot.
      for (const client of this.subscribers)
        if (!client.response.destroyed && !client.response.writableEnded)
          client.response.write('event: stream-error\ndata: {"error":"AUTHORITY_UNAVAILABLE"}\n\n');
      throw error;
    } finally { this.busy = false; }
  }

  private send(client: Subscriber, frame: FoundryStreamFrame): void {
    if (client.response.destroyed || client.response.writableEnded) {
      this.subscribers.delete(client); return;
    }
    if (client.instanceId === frame.instance_id && frame.revision <= client.revision) return;
    client.response.write("id: " + frameId(frame) + "\nevent: snapshot\ndata: " +
      JSON.stringify(frame) + "\n\n");
    client.instanceId = frame.instance_id;
    client.revision = frame.revision;
  }

  /** Mount before Vite's /api proxy. Only GET read endpoints exist. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (!["/api/foundry/events", "/api/foundry/snapshot",
      "/api/foundry/config"].includes(path)) return false;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET" || !isLocal(req)) {
      res.writeHead(403, { "Content-Type": "application/json",
        "Cache-Control": "no-store" });
      res.end('{"error":"LOCAL_READ_ONLY"}');
      return true;
    }
    if (path === "/api/foundry/config") {
      res.writeHead(200, { "Content-Type": "application/json",
        "Cache-Control": "no-store" });
      res.end(JSON.stringify({ protocol: STREAM_PROTOCOL,
        oi_scene_id: this.options.oiSceneId, scene_id: "lunar-foundry-mvp",
        read_only: true }));
      return true;
    }
    if (!this.latest) {
      res.writeHead(503, { "Content-Type": "application/json",
        "Cache-Control": "no-store" });
      res.end('{"error":"AUTHORITY_NOT_READY"}');
      return true;
    }
    if (path === "/api/foundry/snapshot") {
      res.writeHead(200, { "Content-Type": "application/json",
        "Cache-Control": "no-store" });
      res.end(JSON.stringify(this.latest));
      return true;
    }
    const received = req.headers["last-event-id"];
    const match = typeof received === "string" ?
      /^([a-zA-Z0-9_.:-]{1,128}):(\d+)$/.exec(received) : null;
    const parsed = match ? Number(match[2]) : 0;
    const subscriber: Subscriber = {
      response: res,
      instanceId: match?.[1] ?? null,
      revision: Number.isSafeInteger(parsed) ? parsed : 0,
    };
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 750\n\n");
    this.subscribers.add(subscriber);
    this.send(subscriber, this.latest);
    res.on("close", () => this.subscribers.delete(subscriber));
    return true;
  }

  /** Stop delivery and close each subscriber without changing any simulation. */
  close(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.keepalive) clearInterval(this.keepalive);
    this.timer = null;
    this.keepalive = null;
    for (const client of this.subscribers) client.response.end();
    this.subscribers.clear();
  }
}
