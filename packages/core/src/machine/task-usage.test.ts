import { describe, expect, test } from 'bun:test';
import type { Attempt } from '../schema/attempt.ts';
import { taskUsage } from './task-usage.ts';

const base = (over: Partial<Attempt>): Attempt => ({ id: 'a', goalId: 'g', taskId: 't', index: 1, kind: 'work', sessionId: 's', model: 'opus', state: 'passed', costUsd: 1, numTurns: 10, resultSubtype: 'success', baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:10:00Z', skillsUsed: [], continuations: 0, sessions: [], ...over });
const sess = (role: 'worker' | 'reviewer' | 'merger', model: string, costUsd: number, numTurns: number) => ({ role, segment: 0, sessionId: 's', model, costUsd, numTurns, durationMs: 1000, subtype: 'success', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z' });

describe('taskUsage', () => {
  test('sums every session of every attempt, by role, with models and wall time', () => {
    const u = taskUsage([
      base({ id: 'a1', sessions: [sess('worker', 'claude-opus-5', 2, 12), sess('worker', 'claude-opus-5', 1, 5), sess('reviewer', 'claude-haiku-4-5', 0.03, 2)] }),
      base({ id: 'a2', index: 2, startedAt: '2026-01-01T00:20:00Z', endedAt: '2026-01-01T00:30:00Z', sessions: [sess('worker', 'claude-sonnet-5', 1.5, 8), sess('reviewer', 'claude-haiku-4-5', 0.02, 1)] }),
    ]);
    expect(u.attempts).toBe(2);
    expect(u.costUsd).toBeCloseTo(4.55, 5);
    expect(u.turns).toBe(28);
    expect(u.byRole.worker).toEqual({ sessions: 3, costUsd: 4.5, turns: 25 });
    expect(u.byRole.reviewer.sessions).toBe(2);
    expect(u.models).toEqual(['claude-opus-5', 'claude-haiku-4-5', 'claude-sonnet-5']);
    expect(u.wallMin).toBe(30);
  });
  test('attempts without session records fall back to their cumulative cost', () => {
    const u = taskUsage([base({ costUsd: 3, numTurns: 7 }), base({ id: 'm', kind: 'merge', costUsd: 1, numTurns: 4 })]);
    expect(u.costUsd).toBe(4);
    expect(u.byRole.merger).toEqual({ sessions: 1, costUsd: 1, turns: 4 });
    expect(u.models).toEqual(['opus']);
  });
});
