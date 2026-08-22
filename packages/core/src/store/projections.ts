import type { Database } from 'bun:sqlite';
import type { EngineEvent } from '../events.ts';
import type { Attempt, Brief, Check, CheckResult, Escalation, Goal, Task } from '../schema/index.ts';
import type { ObservationReport } from '../schema/observation.ts';

/**
 * Pure-ish reducers: apply one event to the read-model tables.
 * Called inside the same transaction as the event append, and during replay.
 */
export function applyEvent(db: Database, e: EngineEvent): void {
  switch (e.type) {
    case 'goal.created':
      upsertGoal(db, e.payload.goal);
      break;
    case 'goal.state_changed': {
      const g = getGoal(db, e.goalId!);
      if (!g) return;
      const stateBeforeBlock = e.payload.to === 'blocked' ? e.payload.from : e.payload.from === 'blocked' ? null : g.stateBeforeBlock;
      const runningSince = e.payload.to === 'running' && !g.runningSince ? e.ts : g.runningSince;
      upsertGoal(db, { ...g, state: e.payload.to, stateBeforeBlock, runningSince, updatedAt: e.ts });
      break;
    }
    case 'goal.budgets_changed': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, budgets: e.payload.budgets, updatedAt: e.ts });
      break;
    }
    case 'goal.cost_added': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, costUsd: g.costUsd + e.payload.costUsd, updatedAt: e.ts });
      break;
    }
    case 'goal.attachment_added': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, attachments: [...g.attachments.filter((a) => a.id !== e.payload.attachment.id), e.payload.attachment] }); // attachments do not count as progress: updatedAt stays (it freezes the time meter of finished goals)
      break;
    }
    case 'goal.attachment_converted': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, attachments: g.attachments.map((a) => (a.id === e.payload.attachmentId ? { ...a, markdown: e.payload.markdown } : a)) });
      break;
    }
    case 'goal.deleted': {
      for (const t of ['tasks', 'attempts', 'checks', 'check_results', 'briefs', 'observations', 'escalations']) db.run(`DELETE FROM ${t} WHERE goal_id = ?`, [e.goalId!]);
      db.run('DELETE FROM goals WHERE id = ?', [e.goalId!]);
      break;
    }
    case 'goal.attachment_removed': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, attachments: g.attachments.filter((a) => a.id !== e.payload.attachmentId) });
      break;
    }
    case 'brief.proposed':
    case 'brief.edited':
      upsertBrief(db, e.payload.brief, false);
      break;
    case 'brief.approved':
      upsertBrief(db, e.payload.brief, true);
      break;
    case 'task.created': {
      upsertTask(db, e.payload.task);
      if (e.payload.task.origin === 'delivery-fix') {
        const g = getGoal(db, e.goalId!);
        if (g) upsertGoal(db, { ...g, delivery: { ...g.delivery, fixCycles: g.delivery.fixCycles + 1 }, updatedAt: e.ts });
      }
      break;
    }
    case 'delivery.policy_set':
    case 'delivery.started':
    case 'delivery.step':
    case 'delivery.stack_built':
    case 'delivery.pr_opened':
    case 'delivery.checks':
    case 'delivery.merged':
    case 'delivery.completed':
    case 'delivery.failed': {
      const g = getGoal(db, e.goalId!);
      if (!g) break;
      const d = { ...g.delivery, prs: [...g.delivery.prs] };
      const prAt = (pred: (p: (typeof d.prs)[number]) => boolean, patch: Partial<(typeof d.prs)[number]>) => {
        const i = d.prs.findIndex(pred);
        if (i >= 0) d.prs[i] = { ...d.prs[i]!, ...patch };
      };
      switch (e.type) {
        case 'delivery.policy_set':
          d.policy = e.payload.policy;
          if (d.status !== 'running') {
            d.status = 'idle';
            d.step = null;
            d.error = null;
            d.outcome = null;
            d.finishedAt = null;
          }
          break;
        case 'delivery.started':
          d.status = 'running';
          d.step = 'preflight';
          d.error = null;
          d.outcome = null;
          d.startedAt = e.ts;
          d.finishedAt = null;
          d.prs = [];
          break;
        case 'delivery.step':
          d.step = e.payload.step;
          break;
        case 'delivery.stack_built':
          d.prs = e.payload.branches.map((b) => ({ taskId: b.taskId, index: b.index, branch: b.branch, base: b.base, title: b.title, number: null, url: null, state: 'pending' as const, checks: null, mergedRef: null }));
          break;
        case 'delivery.pr_opened': {
          if (!d.pr) d.pr = { number: e.payload.number, url: e.payload.url };
          const i = d.prs.findIndex((p) => p.branch === e.payload.head);
          if (i >= 0) d.prs[i] = { ...d.prs[i]!, number: e.payload.number, url: e.payload.url, base: e.payload.base, state: 'open', title: e.payload.title || d.prs[i]!.title };
          else d.prs.push({ taskId: e.payload.taskId, index: d.prs.length + 1, branch: e.payload.head, base: e.payload.base, title: e.payload.title, number: e.payload.number, url: e.payload.url, state: 'open', checks: null, mergedRef: null });
          break;
        }
        case 'delivery.checks':
          d.checks = e.payload.state;
          if (e.payload.prNumber != null) prAt((p) => p.number === e.payload.prNumber, { checks: e.payload.state });
          else if (d.prs.length === 1) prAt(() => true, { checks: e.payload.state });
          break;
        case 'delivery.merged':
          d.mergedRef = e.payload.ref;
          prAt((p) => p.number === e.payload.prNumber, { state: 'merged', mergedRef: e.payload.ref });
          break;
        case 'delivery.completed':
          d.status = 'delivered';
          d.outcome = e.payload.outcome;
          d.step = null;
          d.finishedAt = e.ts;
          break;
        case 'delivery.failed':
          d.status = 'failed';
          d.error = e.payload.reason;
          d.step = e.payload.step;
          d.finishedAt = e.ts;
          break;
      }
      upsertGoal(db, { ...g, delivery: d, updatedAt: e.ts });
      break;
    }
    case 'task.state_changed': {
      const t = getTask(db, e.payload.taskId);
      if (t) upsertTask(db, { ...t, state: e.payload.to, updatedAt: e.ts });
      break;
    }
    case 'task.workspace_assigned': {
      const t = getTask(db, e.payload.taskId);
      if (t) upsertTask(db, { ...t, branch: e.payload.branch, worktreePath: e.payload.worktreePath, updatedAt: e.ts });
      break;
    }
    case 'task.restarted': {
      const t = getTask(db, e.payload.taskId);
      // a restarted task starts over: its previous worktree/branch (dropped when it finished) must not be reused
      if (t) upsertTask(db, { ...t, state: 'pending', extraAttempts: t.extraAttempts + e.payload.extraAttempts, baseRef: null, commitRef: null, commitMessage: null, branch: null, worktreePath: null, updatedAt: e.ts });
      break;
    }
    case 'goal.models_changed': {
      const g = getGoal(db, e.goalId!);
      if (g && e.payload.tier) upsertGoal(db, { ...g, models: { ...g.models, [e.payload.tier]: e.payload.to }, updatedAt: e.ts });
      break;
    }
    case 'goal.reclarified': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, baseSync: e.payload.workspaceRebuilt ? null : g.baseSync, autoskills: e.payload.workspaceRebuilt ? null : g.autoskills, updatedAt: e.ts });
      break;
    }
    case 'goal.base_synced': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, baseSync: { ...e.payload, at: e.ts } });
      break;
    }
    case 'goal.autoskills': {
      const g = getGoal(db, e.goalId!);
      if (g) upsertGoal(db, { ...g, autoskills: { status: e.payload.status, skills: e.payload.skills, detail: e.payload.detail, at: e.ts } });
      break;
    }
    case 'task.base_ref': {
      const t = getTask(db, e.payload.taskId);
      if (t) upsertTask(db, { ...t, baseRef: e.payload.ref, updatedAt: e.ts });
      break;
    }
    case 'task.committed': {
      const t = getTask(db, e.payload.taskId);
      if (t) upsertTask(db, { ...t, commitRef: e.payload.ref, commitMessage: e.payload.message, updatedAt: e.ts });
      break;
    }
    case 'task.hint_set': {
      const t = getTask(db, e.payload.taskId);
      if (t) upsertTask(db, { ...t, hint: e.payload.hint, extraAttempts: t.extraAttempts + e.payload.extraAttempts, updatedAt: e.ts });
      break;
    }
    case 'check.created':
      upsertCheck(db, e.payload.check);
      break;
    case 'attempt.started':
      upsertAttempt(db, e.payload.attempt);
      break;
    case 'attempt.session': {
      const a = getAttempt(db, e.payload.attemptId);
      if (a) upsertAttempt(db, { ...a, sessionId: e.payload.sessionId, model: e.payload.model ?? a.model, pid: e.payload.pid ?? a.pid, state: 'running' });
      break;
    }
    case 'attempt.finished': {
      const a = getAttempt(db, e.payload.attemptId);
      if (a)
        upsertAttempt(db, {
          ...a,
          state: e.payload.state,
          resultSubtype: e.payload.resultSubtype,
          costUsd: e.payload.costUsd,
          numTurns: e.payload.numTurns,
          endRef: e.payload.endRef,
          endedAt: e.ts,
          pid: null,
          skillsUsed: e.payload.skillsUsed ?? [],
        });
      break;
    }
    case 'attempt.concluded': {
      const a = getAttempt(db, e.payload.attemptId);
      if (a) upsertAttempt(db, { ...a, state: e.payload.state, endedAt: a.endedAt ?? e.ts });
      break;
    }
    case 'attempt.continued': {
      const a = getAttempt(db, e.payload.attemptId);
      if (a) upsertAttempt(db, { ...a, state: 'running', continuations: a.continuations + 1, endedAt: null, pid: null });
      break;
    }
    case 'check.finished':
      upsertCheckResult(db, e.payload.result);
      break;
    case 'observation.reported':
      upsertObservation(db, e.payload.report);
      break;
    case 'review.goal.finished': {
      const g = getGoal(db, e.goalId!);
      if (g && e.payload.fixTaskIds.length) upsertGoal(db, { ...g, fixCycles: g.fixCycles + 1, updatedAt: e.ts });
      break;
    }
    case 'session.usage': {
      const p = e.payload;
      db.run(
        'INSERT OR REPLACE INTO usage_ledger (event_id, ts, goal_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, duration_ms, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [e.id, e.ts, e.goalId, p.kind, p.model, p.inputTokens, p.outputTokens, p.cacheReadTokens, p.cacheCreateTokens, p.costUsd, p.durationMs, p.subtype],
      );
      if (p.rateLimit) {
        db.run('INSERT OR REPLACE INTO rate_limit_state (rate_limit_type, status, resets_at, is_using_overage, seen_at) VALUES (?, ?, ?, ?, ?)', [p.rateLimit.rateLimitType ?? 'unknown', p.rateLimit.status, p.rateLimit.resetsAt, p.rateLimit.isUsingOverage ? 1 : 0, e.ts]);
      }
      break;
    }
    case 'escalation.raised':
      upsertEscalation(db, e.payload.escalation);
      break;
    case 'escalation.answered': {
      const esc = getEscalation(db, e.payload.escalationId);
      if (esc) upsertEscalation(db, { ...esc, state: 'answered', answer: e.payload.answer, answeredAt: e.ts });
      break;
    }
    default:
      // informational events: clarify.started, review.task.finished, workspace.*, merge.*, budget.snapshot, boundary.blocked, engine.note
      break;
  }
}

// ---------- read-model helpers ----------

function row<T>(r: unknown): T | null {
  if (!r) return null;
  return JSON.parse((r as { data: string }).data) as T;
}

export function getGoal(db: Database, id: string): Goal | null {
  return row<Goal>(db.query('SELECT data FROM goals WHERE id = ?').get(id));
}
export function listGoals(db: Database): Goal[] {
  return (db.query('SELECT data FROM goals ORDER BY created_at DESC').all() as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertGoal(db: Database, g: Goal): void {
  db.run(
    'INSERT INTO goals (id, state, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, data = excluded.data',
    [g.id, g.state, g.createdAt, g.updatedAt, JSON.stringify(g)],
  );
}

export function getTask(db: Database, id: string): Task | null {
  return row<Task>(db.query('SELECT data FROM tasks WHERE id = ?').get(id));
}
export function listTasks(db: Database, goalId: string): Task[] {
  return (db.query('SELECT data FROM tasks WHERE goal_id = ? ORDER BY rowid').all(goalId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertTask(db: Database, t: Task): void {
  db.run(
    'INSERT INTO tasks (id, goal_id, state, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data',
    [t.id, t.goalId, t.state, JSON.stringify(t)],
  );
}

export function getAttempt(db: Database, id: string): Attempt | null {
  return row<Attempt>(db.query('SELECT data FROM attempts WHERE id = ?').get(id));
}
export function listAttempts(db: Database, taskId: string): Attempt[] {
  return (db.query('SELECT data FROM attempts WHERE task_id = ? ORDER BY rowid').all(taskId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function listAttemptsByGoal(db: Database, goalId: string): Attempt[] {
  return (db.query('SELECT data FROM attempts WHERE goal_id = ? ORDER BY rowid').all(goalId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function listRunningAttempts(db: Database): Attempt[] {
  return (db.query("SELECT data FROM attempts WHERE state IN ('created','running','observing')").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertAttempt(db: Database, a: Attempt): void {
  db.run(
    'INSERT INTO attempts (id, goal_id, task_id, state, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data',
    [a.id, a.goalId, a.taskId, a.state, JSON.stringify(a)],
  );
}

export function listChecks(db: Database, goalId: string): Check[] {
  return (db.query('SELECT data FROM checks WHERE goal_id = ? ORDER BY rowid').all(goalId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertCheck(db: Database, c: Check): void {
  db.run(
    'INSERT INTO checks (id, goal_id, task_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    [c.id, c.goalId, c.taskId, JSON.stringify(c)],
  );
}

export function listCheckResults(db: Database, attemptId: string): CheckResult[] {
  return (db.query('SELECT data FROM check_results WHERE attempt_id = ? ORDER BY rowid').all(attemptId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function listCheckResultsByGoal(db: Database, goalId: string): CheckResult[] {
  return (db.query('SELECT data FROM check_results WHERE goal_id = ? ORDER BY rowid').all(goalId) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertCheckResult(db: Database, r: CheckResult): void {
  db.run(
    'INSERT INTO check_results (id, goal_id, check_id, attempt_id, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    [r.id, r.goalId, r.checkId, r.attemptId, JSON.stringify(r)],
  );
}

export function getBrief(db: Database, goalId: string): { brief: Brief; approved: boolean } | null {
  const r = db.query('SELECT data, approved FROM briefs WHERE goal_id = ?').get(goalId) as { data: string; approved: number } | null;
  return r ? { brief: JSON.parse(r.data), approved: r.approved === 1 } : null;
}
export function upsertBrief(db: Database, b: Brief, approved: boolean): void {
  db.run(
    'INSERT INTO briefs (goal_id, approved, data) VALUES (?, ?, ?) ON CONFLICT(goal_id) DO UPDATE SET approved = excluded.approved, data = excluded.data',
    [b.goalId, approved ? 1 : 0, JSON.stringify(b)],
  );
}

export function getObservation(db: Database, attemptId: string): ObservationReport | null {
  return row<ObservationReport>(db.query('SELECT data FROM observations WHERE attempt_id = ?').get(attemptId));
}
export function upsertObservation(db: Database, o: ObservationReport): void {
  db.run(
    'INSERT INTO observations (attempt_id, goal_id, task_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(attempt_id) DO UPDATE SET data = excluded.data',
    [o.attemptId, o.goalId, o.taskId, JSON.stringify(o)],
  );
}

export function getEscalation(db: Database, id: string): Escalation | null {
  return row<Escalation>(db.query('SELECT data FROM escalations WHERE id = ?').get(id));
}
export function listEscalations(db: Database, opts: { goalId?: string; openOnly?: boolean } = {}): Escalation[] {
  const where: string[] = [];
  const args: string[] = [];
  if (opts.goalId) {
    where.push('goal_id = ?');
    args.push(opts.goalId);
  }
  if (opts.openOnly) where.push("state = 'open'");
  const sql = `SELECT data FROM escalations ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY rowid DESC`;
  return (db.query(sql).all(...args) as { data: string }[]).map((r) => JSON.parse(r.data));
}
export function upsertEscalation(db: Database, e: Escalation): void {
  db.run(
    'INSERT INTO escalations (id, goal_id, task_id, state, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data',
    [e.id, e.goalId, e.taskId, e.state, JSON.stringify(e)],
  );
}

export function bumpStat(db: Database, key: string, value: number): void {
  db.run(
    'INSERT INTO stats (key, count, total) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, total = total + excluded.total',
    [key, value],
  );
}
export function getStatAvg(db: Database, key: string): number | null {
  const r = db.query('SELECT count, total FROM stats WHERE key = ?').get(key) as { count: number; total: number } | null;
  return r && r.count > 0 ? r.total / r.count : null;
}

export interface UsageRow {
  ts: string;
  goal_id: string | null;
  kind: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  cost_usd: number;
  duration_ms: number;
  subtype: string;
}
export function listUsageSince(db: Database, sinceIso: string): UsageRow[] {
  return db.query('SELECT ts, goal_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, duration_ms, subtype FROM usage_ledger WHERE ts >= ? ORDER BY ts').all(sinceIso) as UsageRow[];
}
export interface RateLimitRow {
  rate_limit_type: string;
  status: string;
  resets_at: number | null;
  is_using_overage: number;
  seen_at: string;
}
export function listRateLimitState(db: Database): RateLimitRow[] {
  return db.query('SELECT rate_limit_type, status, resets_at, is_using_overage, seen_at FROM rate_limit_state ORDER BY rate_limit_type').all() as RateLimitRow[];
}

const READ_MODEL_TABLES = ['goals', 'tasks', 'attempts', 'checks', 'check_results', 'briefs', 'observations', 'escalations', 'usage_ledger', 'rate_limit_state'];

export function clearReadModels(db: Database): void {
  for (const t of READ_MODEL_TABLES) db.exec(`DELETE FROM ${t}`);
}
