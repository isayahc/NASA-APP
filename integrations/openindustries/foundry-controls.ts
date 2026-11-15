/** Local authenticated writes and bounded wall-clock scheduling, separate from F1 GETs. */
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FoundryDatabase } from './foundry-runtime.ts';
import { isLocal } from './foundry-sse.ts';

const COOKIE = 'nasa_foundry_operator';
const ACTIONS = new Set(['start', 'step', 'pause-plant', 'resume-plant', 'reset', 'set-speed', 'set-power', 'set-feeder-blocked']);
export class FoundryControls {
  private sessions = new Map<string, { expires: number; lease: number; streams: Set<ServerResponse> }>();
  private runner: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  constructor(private db: FoundryDatabase, private token: string, private root: string,
    private changed: () => Promise<void>, private now = Date.now) {}

  active(): string { return this.db.lineage(this.token, this.root).at(-1)!; }
  private cookie(req: IncomingMessage): string {
    return (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? '';
  }
  private operator(req: IncomingMessage) {
    const key = this.cookie(req), session = this.sessions.get(key);
    if (!session || session.expires <= this.now()) throw Error('AUTH_REQUIRED');
    this.db.identity(this.token);
    return { key, session };
  }
  observeStream(req: IncomingMessage, res: ServerResponse): void {
    if (req.url?.split('?')[0] !== '/api/foundry/events' || !isLocal(req)) return;
    try {
      const { key, session } = this.operator(req);
      session.streams.add(res);
      res.once('close', () => {
        session.streams.delete(res);
        if (this.runner === key && session.streams.size === 0) this.pauseClock();
      });
    } catch { /* Read-only viewers never acquire clock authority. */ }
  }
  /** A server restart never silently resumes a previously running clock. */
  initialize(): void { this.pauseClock(); }
  private pauseClock(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.runner = null;
    try {
      const snapshot = this.db.read(this.token, this.active());
      if (snapshot.controls.running) {
        this.db.execute(this.token, { instance_id: snapshot.instance_id, command_id: randomUUID(),
          expected_revision: snapshot.revision, action: 'pause-plant', payload: {} });
        void this.changed().catch(() => {});
      }
    } catch { /* Expired auth/database loss halts scheduling; no unvalidated fallback. */ }
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || !this.runner) return;
    const snapshot = this.db.read(this.token, this.active());
    if (!snapshot.controls.running) { this.runner = null; return; }
    const delay = snapshot.machines[0].step_duration_ms / snapshot.controls.speed;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        const session = this.sessions.get(this.runner ?? '');
        if (!session || session.expires <= this.now() || session.streams.size === 0 || this.now() - session.lease > 2500) {
          this.pauseClock(); return;
        }
        const head = this.db.read(this.token, this.active());
        if (!head.controls.running) { this.runner = null; return; }
        this.db.execute(this.token, { instance_id: head.instance_id, command_id: randomUUID(),
          expected_revision: head.revision, action: 'clock-step', payload: {} });
        void this.changed().catch(() => {});
        this.schedule();
      } catch { this.pauseClock(); }
    }, delay);
    this.timer.unref?.();
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = req.url?.split('?')[0];
    if (!['/api/foundry/control-session', '/api/foundry/commands', '/api/foundry/control-lease'].includes(path ?? '')) return false;
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (!isLocal(req)) { reply(403, { error: 'LOCAL_ONLY' }); return true; }
    try {
      if (path === '/api/foundry/control-session' && req.method === 'GET') {
        this.db.identity(this.token);
        let key = this.cookie(req), session = this.sessions.get(key);
        if (!session || session.expires <= this.now()) {
          for (const [id, old] of this.sessions) if (old.expires <= this.now()) this.sessions.delete(id);
          if (this.sessions.size >= 32) throw Error('SESSION_LIMIT');
          key = randomBytes(32).toString('hex');
          session = { expires: this.now() + 8 * 3600000, lease: this.now(), streams: new Set() };
          this.sessions.set(key, session);
        }
        res.setHeader('Set-Cookie', `${COOKIE}=${key}; HttpOnly; SameSite=Strict; Path=/api/foundry; Max-Age=28800`);
        reply(200, { controls: true }); return true;
      }
      if (path === '/api/foundry/control-session' || req.method !== 'POST' || req.headers.origin !== 'http://' + req.headers.host ||
          req.headers['x-foundry-command'] !== '1') { reply(403, { error: 'SAME_ORIGIN_COMMAND_REQUIRED' }); return true; }
      const { key, session } = this.operator(req);
      if (path === '/api/foundry/control-lease') {
        session.lease = this.now(); reply(200, { renewed: true }); return true;
      }
      if (!req.headers['content-type']?.startsWith('application/json')) throw Error('INVALID_REQUEST');
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 8192) { reply(413, { error: 'REQUEST_TOO_LARGE' }); return true; }
      }
      let command;
      try { command = JSON.parse(text); } catch { throw Error('INVALID_REQUEST'); }
      if (!ACTIONS.has(command?.action) || !this.db.lineage(this.token, this.root).includes(command.instance_id)) throw Error('INVALID_REQUEST');
      if (command.action === 'resume-plant' && session.streams.size === 0) throw Error('STREAM_REQUIRED');
      const before = this.db.read(this.token, this.active());
      const result = this.db.execute(this.token, command);
      const committed = result.snapshot.instance_id === before.instance_id && result.snapshot.revision > before.revision;
      if (committed) {
        if (command.action === 'resume-plant') { this.runner = key; session.lease = this.now(); }
        if (command.action === 'reset' || command.action === 'pause-plant') this.runner = null;
        this.schedule();
        await this.changed();
      }
      reply(200, result);
    } catch (error: any) {
      const code = error?.code ?? error?.message ?? 'COMMAND_FAILED';
      const status = code === 'AUTH_REQUIRED' ? 401 : ['CONFLICT', 'COMMAND_ID_REUSED'].includes(code) ? 409 : 400;
      reply(status, { error: String(code).slice(0, 180) });
    }
    return true;
  }
  close(): void { this.stopped = true; this.pauseClock(); this.sessions.clear(); }
}
