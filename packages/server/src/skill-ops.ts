import type { StreamEvent } from '@foundry/engine';

/** What the Skills page can start; each one gets its own live channel and a record the page can poll. */
export type SkillOpKind = 'install' | 'install-tier' | 'update' | 'adopt' | 'uninstall' | 'tool-install';
export type SkillOpStatus = 'running' | 'ok' | 'failed';
export interface SkillOp {
  id: string;
  /** the live channel its output streams to: `skills-op:<id>` */
  channel: string;
  kind: SkillOpKind;
  label: string;
  status: SkillOpStatus;
  startedAt: string;
  endedAt: string | null;
  /** one line on how it ended (null while running) */
  summary: string | null;
}

/** Ids a browser may choose for its own operation (so it can follow the channel before the request returns). */
export const OP_ID = /^[A-Za-z0-9_-]{4,64}$/;
const PREFIX = 'skills-op:';
export const opChannel = (id: string) => `${PREFIX}${id}`;
export const opIdOfChannel = (channel: string): string | null => (channel.startsWith(PREFIX) ? channel.slice(PREFIX.length) : null);

/** A refused operation id (malformed or already used); the route answers with `status`. */
export class SkillOpError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 409,
  ) {
    super(message);
  }
}

/** A handle to a running operation: `say` streams a line, `finish` records how it ended (once). */
export interface SkillOpHandle {
  op: SkillOp;
  say: (line: string) => void;
  finish: (ok: boolean, summary: string) => SkillOp;
}

type Entry = { op: SkillOp; lines: string[] };

/**
 * The Skills page's operations: every install, tier install, adoption, bulk uninstall, tool install and source update
 * streams to a channel of its own and leaves a record (running → ok / failed) that outlives the request, so the page
 * can show several at once, pick them up again after a reload and read their output back. In memory only: a server
 * restart forgets them (the page then marks a still-running tab as lost). The last `keep` operations are kept.
 */
export class SkillOps {
  private ops = new Map<string, Entry>();
  constructor(
    private broadcast: (s: StreamEvent) => void,
    private limits = { keep: 50, lines: 1000 },
  ) {}

  /** Register an operation and announce it on its channel. `mirror` also sends every line to an older shared channel. */
  begin(kind: SkillOpKind, label: string, opts: { id?: string; mirror?: string } = {}): SkillOpHandle {
    const id = opts.id ?? crypto.randomUUID().slice(0, 12);
    if (!OP_ID.test(id)) throw new SkillOpError('bad operation id', 400);
    if (this.ops.has(id)) throw new SkillOpError(`operation ${id} already exists`, 409);
    const op: SkillOp = { id, channel: opChannel(id), kind, label, status: 'running', startedAt: new Date().toISOString(), endedAt: null, summary: null };
    const entry: Entry = { op, lines: [] };
    this.ops.set(id, entry);
    this.prune();
    const emit = (channel: string, text: string) => this.broadcast({ goalId: '', taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
    const say = (line: string) => {
      entry.lines.push(line);
      if (entry.lines.length > this.limits.lines) entry.lines.splice(0, entry.lines.length - this.limits.lines);
      emit(op.channel, line);
      if (opts.mirror) emit(opts.mirror, line);
    };
    const finish = (ok: boolean, summary: string) => {
      if (op.status !== 'running') return op;
      say(`${ok ? '✔' : '✘'} ${summary}`);
      Object.assign(op, { status: ok ? 'ok' : 'failed', endedAt: new Date().toISOString(), summary });
      return op;
    };
    say(`▶ ${label}`);
    return { op, say, finish };
  }

  /**
   * Run `work` as an operation and wait for it: `outcome` turns its result into ok/failed + summary.
   * A thrown error ends it as failed and is re-thrown with the operation attached (see `opOf`).
   */
  async run<T>(kind: SkillOpKind, label: string, opts: { id?: string; mirror?: string }, work: (say: (l: string) => void) => Promise<T>, outcome: (r: T) => { ok: boolean; summary: string }): Promise<{ op: SkillOp; result: T }> {
    const h = this.begin(kind, label, opts);
    try {
      const result = await work(h.say);
      const o = outcome(result);
      return { op: h.finish(o.ok, o.summary), result };
    } catch (e) {
      h.finish(false, String((e as Error)?.message ?? e));
      throw attachOp(e, h.op);
    }
  }

  /** Start `work` in the background; the operation ends when it settles. Returns the running operation. */
  start<T>(kind: SkillOpKind, label: string, opts: { id?: string; mirror?: string }, work: (say: (l: string) => void) => Promise<T>, outcome: (r: T) => { ok: boolean; summary: string }): SkillOp {
    const h = this.begin(kind, label, opts);
    void Promise.resolve()
      .then(() => work(h.say))
      .then(
        (r) => {
          const o = outcome(r);
          h.finish(o.ok, o.summary);
        },
        (e) => h.finish(false, String((e as Error)?.message ?? e)),
      );
    return h.op;
  }

  get(id: string): SkillOp | null {
    return this.ops.get(id)?.op ?? null;
  }
  /** newest first */
  list(): SkillOp[] {
    return [...this.ops.values()].map((e) => e.op).reverse();
  }
  /** The output so far as live-log events, for `/api/stream/:channel/history`; null for an unknown operation. */
  history(id: string, limit = 400): { kind: 'text'; text: string }[] | null {
    const e = this.ops.get(id);
    return e ? e.lines.slice(-limit).map((text) => ({ kind: 'text' as const, text })) : null;
  }

  private prune() {
    for (const [id, e] of this.ops) {
      if (this.ops.size <= this.limits.keep) break;
      if (e.op.status !== 'running') this.ops.delete(id);
    }
  }
}

const OPS = new WeakMap<object, SkillOp>();
function attachOp(e: unknown, op: SkillOp): unknown {
  if (e && typeof e === 'object') OPS.set(e, op);
  return e;
}
/** The operation a thrown error ended, so the error response can name it. */
export function opOf(e: unknown): SkillOp | null {
  return e && typeof e === 'object' ? (OPS.get(e) ?? null) : null;
}
