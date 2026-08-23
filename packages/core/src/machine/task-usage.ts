import type { Attempt, AttemptSession } from '../schema/attempt.ts';

export interface TaskUsage {
  attempts: number;
  /** worker + reviewer + merger, every session of every attempt */
  costUsd: number;
  turns: number;
  /** wall-clock minutes from the first attempt's start to the last session's end (or now while running) */
  wallMin: number;
  byRole: Record<AttemptSession['role'], { sessions: number; costUsd: number; turns: number }>;
  /** resolved model ids seen, most used first */
  models: string[];
}

/** Everything a task has cost so far — all attempts, all their sessions. Pre-session attempts fall back to their cumulative worker cost. */
export function taskUsage(attempts: Attempt[], now = new Date()): TaskUsage {
  const byRole: TaskUsage['byRole'] = { worker: { sessions: 0, costUsd: 0, turns: 0 }, reviewer: { sessions: 0, costUsd: 0, turns: 0 }, merger: { sessions: 0, costUsd: 0, turns: 0 } };
  const models = new Map<string, number>();
  let cost = 0;
  let turns = 0;
  for (const a of attempts) {
    if (a.sessions.length) {
      for (const s of a.sessions) {
        byRole[s.role].sessions++;
        byRole[s.role].costUsd += s.costUsd;
        byRole[s.role].turns += s.numTurns;
        cost += s.costUsd;
        turns += s.numTurns;
        if (s.model) models.set(s.model, (models.get(s.model) ?? 0) + 1);
      }
    } else {
      // attempts recorded before per-session accounting existed
      const role = a.kind === 'merge' ? 'merger' : 'worker';
      byRole[role].sessions++;
      byRole[role].costUsd += a.costUsd;
      byRole[role].turns += a.numTurns;
      cost += a.costUsd;
      turns += a.numTurns;
      if (a.model) models.set(a.model, (models.get(a.model) ?? 0) + 1);
    }
  }
  const first = attempts.length ? Math.min(...attempts.map((a) => Date.parse(a.startedAt))) : null;
  const last = attempts.length ? Math.max(...attempts.map((a) => (a.endedAt ? Date.parse(a.endedAt) : now.getTime()))) : null;
  return {
    attempts: attempts.length,
    costUsd: cost,
    turns,
    wallMin: first != null && last != null ? Math.max(0, (last - first) / 60_000) : 0,
    byRole,
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
  };
}
