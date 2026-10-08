import type { Database } from 'bun:sqlite';
import { EngineEvent, type NewEvent } from '../events.ts';
import { newId, IdPrefix } from '../ids.ts';
import { applyEvent, clearReadModels } from './projections.ts';

export type EventListener = (event: EngineEvent) => void;

interface EventRow {
  seq: number;
  id: string;
  ts: string;
  goal_id: string | null;
  type: string;
  payload: string;
}

/**
 * Append-only event log + synchronous projection into read models (same transaction).
 * Listeners are notified after the transaction commits.
 */
export class EventStore {
  private listeners = new Set<EventListener>();
  private insert;
  private sinceQuery;

  constructor(public readonly db: Database) {
    this.insert = db.query('INSERT INTO events (id, ts, goal_id, type, payload) VALUES (?, ?, ?, ?, ?)');
    this.sinceQuery = db.query('SELECT seq, id, ts, goal_id, type, payload FROM events WHERE seq > ? ORDER BY seq');
  }

  append(e: NewEvent): EngineEvent {
    const full = EngineEvent.parse({ id: newId(IdPrefix.event), ts: new Date().toISOString(), ...e });
    this.db.transaction(() => {
      this.insert.run(full.id, full.ts, full.goalId, full.type, JSON.stringify(full.payload));
      applyEvent(this.db, full);
    })();
    for (const l of this.listeners) {
      try {
        l(full);
      } catch (err) {
        console.error('[event-store] listener error', err);
      }
    }
    return full;
  }

  /** Whether the log holds any event of this goal: one that is here, or one deleted here (its events stay) */
  hasGoalEvents(goalId: string): boolean {
    return !!this.db.query('SELECT 1 FROM events WHERE goal_id = ? LIMIT 1').get(goalId);
  }

  /**
   * Bring one goal's events from another instance (Transfer, ADR-0030). They keep their ids and times, are upgraded by
   * parsing like any old event, and are projected in one transaction: all of them or none. Listeners hear nothing —
   * history is not news, and nothing may tick a goal that is only being read in.
   */
  importGoalEvents(goalId: string, rows: unknown[]): number {
    const events = rows.map((r) => EngineEvent.parse(r));
    const stray = events.find((e) => e.goalId !== goalId);
    if (stray) throw new Error(`event ${stray.id} belongs to ${stray.goalId}, not ${goalId}`);
    if (this.hasGoalEvents(goalId)) throw new Error(`goal ${goalId} is already here`);
    this.db.transaction(() => {
      for (const e of events) {
        this.insert.run(e.id, e.ts, e.goalId, e.type, JSON.stringify(e.payload));
        applyEvent(this.db, e);
      }
    })();
    return events.length;
  }

  subscribe(l: EventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  count(): number {
    return (this.db.query('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;
  }

  *iterate(sinceSeq = 0): Generator<EngineEvent & { seq: number }> {
    for (const r of this.sinceQuery.all(sinceSeq) as EventRow[]) {
      yield { seq: r.seq, ...EngineEvent.parse({ id: r.id, ts: r.ts, goalId: r.goal_id, type: r.type, payload: JSON.parse(r.payload) }) };
    }
  }

  listByGoal(goalId: string, limit = 500): (EngineEvent & { seq: number })[] {
    const rows = this.db
      .query('SELECT seq, id, ts, goal_id, type, payload FROM events WHERE goal_id = ? ORDER BY seq DESC LIMIT ?')
      .all(goalId, limit) as EventRow[];
    return rows
      .reverse()
      .map((r) => ({ seq: r.seq, ...EngineEvent.parse({ id: r.id, ts: r.ts, goalId: r.goal_id, type: r.type, payload: JSON.parse(r.payload) }) }));
  }

  /** All of a goal's events of the given types, oldest first: the few that matter however long the goal's log grew */
  listByGoalOfTypes(goalId: string, types: EngineEvent['type'][]): (EngineEvent & { seq: number })[] {
    if (!types.length) return [];
    const rows = this.db
      .query(`SELECT seq, id, ts, goal_id, type, payload FROM events WHERE goal_id = ? AND type IN (${types.map(() => '?').join(', ')}) ORDER BY seq`)
      .all(goalId, ...types) as EventRow[];
    return rows.map((r) => ({ seq: r.seq, ...EngineEvent.parse({ id: r.id, ts: r.ts, goalId: r.goal_id, type: r.type, payload: JSON.parse(r.payload) }) }));
  }

  /** Newest-first events of one type (informational logs such as skills.update_run). */
  listByType(type: EngineEvent['type'], limit = 50): (EngineEvent & { seq: number })[] {
    const rows = this.db.query('SELECT seq, id, ts, goal_id, type, payload FROM events WHERE type = ? ORDER BY seq DESC LIMIT ?').all(type, limit) as EventRow[];
    return rows.map((r) => ({ seq: r.seq, ...EngineEvent.parse({ id: r.id, ts: r.ts, goalId: r.goal_id, type: r.type, payload: JSON.parse(r.payload) }) }));
  }

  /** Drop read models and rebuild them from the log. */
  replay(): number {
    let n = 0;
    this.db.transaction(() => {
      clearReadModels(this.db);
      for (const e of this.iterate(0)) {
        applyEvent(this.db, e);
        n++;
      }
    })();
    return n;
  }

  /** Snapshot read-model tables as JSON for `replay --verify`. */
  snapshotReadModels(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const t of ['goals', 'tasks', 'attempts', 'checks', 'check_results', 'briefs', 'observations', 'escalations']) {
      out[t] = (this.db.query(`SELECT data FROM ${t} ORDER BY 1`).all() as { data: string }[]).map((r) => r.data).sort();
    }
    for (const t of ['usage_ledger', 'rate_limit_state']) {
      out[t] = (this.db.query(`SELECT * FROM ${t}`).all() as object[]).map((r) => JSON.stringify(r)).sort();
    }
    return out;
  }
}
