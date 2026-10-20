import type { EngineEvent, Goal } from '@foundry/core';
import type { InstalledSkill } from './types.ts';

/** Does an invoked skill name (`tdd`, `mattpocock-skills:tdd`) name this row? A suite row (`pstack:tdd`) matches only exactly. */
export const skillMatches = (invoked: string, name: string): boolean => invoked === name || (!name.includes(':') && invoked.endsWith(`:${name}`));

/**
 * How many of the newest `limit` Claude goals, and how many of their sessions, invoked each installed skill.
 * A session is counted once by its id, whether its `session.usage` or its finished attempt names the skill.
 * Project rows get `usage: null`; with no goals in the window nothing is `unused` (unknown, not unused).
 */
export function skillUsage(input: { installed: InstalledSkill[]; goals: Pick<Goal, 'id' | 'createdAt' | 'provider'>[]; events: (goalId: string) => EngineEvent[]; limit?: number }): { installed: InstalledSkill[]; window: { goals: number; limit: number } } {
  const limit = input.limit ?? 30;
  const goals = input.goals.filter((g) => (g.provider ?? 'claude') === 'claude').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  const calls: { goalId: string; session: string; ts: string; skills: string[] }[] = [];
  for (const g of goals) {
    const sessionOf = new Map<string, string>();
    for (const e of input.events(g.id)) {
      if (e.type === 'attempt.started' && e.payload.attempt.sessionId) sessionOf.set(e.payload.attempt.id, e.payload.attempt.sessionId);
      else if (e.type === 'attempt.session') sessionOf.set(e.payload.attemptId, e.payload.sessionId);
      else if (e.type === 'session.usage') calls.push({ goalId: g.id, session: e.payload.sessionId ?? `usage:${e.id}`, ts: e.ts, skills: e.payload.skillsUsed });
      else if (e.type === 'attempt.finished') calls.push({ goalId: g.id, session: sessionOf.get(e.payload.attemptId) ?? `attempt:${e.payload.attemptId}`, ts: e.ts, skills: e.payload.skillsUsed });
    }
  }
  const installed = input.installed.map((row) => {
    if (row.scope === 'project') return { ...row, usage: null };
    const hits = calls.filter((c) => c.skills.some((s) => skillMatches(s.replace(/^\//, ''), row.name)));
    const lastUsedAt = hits.reduce<string | null>((last, c) => (last && last > c.ts ? last : c.ts), null);
    return { ...row, usage: { goals: new Set(hits.map((c) => c.goalId)).size, sessions: new Set(hits.map((c) => c.session)).size, lastUsedAt, unused: !hits.length && goals.length > 0 } };
  });
  return { installed, window: { goals: goals.length, limit } };
}
