import { describe, expect, test } from 'bun:test';
import { EngineEvent } from '@foundry/core';
import type { InstalledSkill } from './types.ts';
import { skillMatches, skillUsage } from './usage.ts';

const row = (name: string, scope: InstalledSkill['scope'] = 'user'): InstalledSkill => ({ name, scope, invoke: `/${name}`, dir: `/skills/${name}`, skillMd: null, description: '', version: null, managedBy: null, marker: null, plugin: null, lock: null, symlink: null, manifest: null, duplicateOf: [], canUninstall: scope === 'user', uninstallNote: null, hint: null, unparsable: false });
const goal = (id: string, createdAt: string, provider?: 'claude' | 'codex') => ({ id, createdAt, provider });

let seq = 0;
const ev = (goalId: string, ts: string, type: EngineEvent['type'], payload: object) => EngineEvent.parse({ id: `e${++seq}`, ts, goalId, type, payload });
const used = (goalId: string, ts: string, sessionId: string | null, skillsUsed: string[]) => ev(goalId, ts, 'session.usage', { sessionId, kind: 'attempt', model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, durationMs: 0, subtype: 'success', rateLimit: null, skillsUsed });
const finished = (goalId: string, ts: string, attemptId: string, skillsUsed: string[]) => ev(goalId, ts, 'attempt.finished', { attemptId, state: 'observing', resultSubtype: 'success', costUsd: 0, numTurns: 1, endRef: null, permissionDenials: [], skillsUsed });
const session = (goalId: string, ts: string, attemptId: string, sessionId: string) => ev(goalId, ts, 'attempt.session', { attemptId, sessionId, model: null, pid: null });
const started = (goalId: string, ts: string, id: string, sessionId: string) => ev(goalId, ts, 'attempt.started', { attempt: { id, goalId, taskId: 't1', index: 1, kind: 'work', sessionId, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: ts, endedAt: null } });

const run = (installed: InstalledSkill[], goals: ReturnType<typeof goal>[], log: EngineEvent[], limit?: number) => skillUsage({ installed, goals, events: (id) => log.filter((e) => e.goalId === id), limit });
const usageOf = (r: ReturnType<typeof skillUsage>, name: string, scope: InstalledSkill['scope'] = 'user') => r.installed.find((s) => s.name === name && s.scope === scope)?.usage;

describe('skillMatches', () => {
  test('a bare row matches its name bare or behind any prefix, never a longer name', () => {
    expect(skillMatches('tdd', 'tdd')).toBe(true);
    expect(skillMatches('mattpocock-skills:tdd', 'tdd')).toBe(true);
    expect(skillMatches('pstack:tdd', 'tdd')).toBe(true);
    expect(skillMatches('xtdd', 'tdd')).toBe(false);
    expect(skillMatches('tdd-extra', 'tdd')).toBe(false);
  });
  test('a suite row matches only its exact name', () => {
    expect(skillMatches('pstack:tdd', 'pstack:tdd')).toBe(true);
    expect(skillMatches('tdd', 'pstack:tdd')).toBe(false);
    expect(skillMatches('mattpocock-skills:tdd', 'pstack:tdd')).toBe(false);
    expect(skillMatches('other:pstack:tdd', 'pstack:tdd')).toBe(false);
  });
});

describe('skillUsage', () => {
  test('a prefixed and a bare invocation both count for a user row, and a prefixed one for a plugin row and its user-level shadow', () => {
    const r = run([row('tdd'), row('tdd', 'plugin'), row('diagnosing-bugs')], [goal('g1', '2026-10-01T00:00:00Z')], [used('g1', '2026-10-01T01:00:00Z', 's1', ['mattpocock-skills:tdd']), used('g1', '2026-10-01T02:00:00Z', 's2', ['tdd'])]);
    expect(usageOf(r, 'tdd')).toEqual({ goals: 1, sessions: 2, lastUsedAt: '2026-10-01T02:00:00Z', unused: false });
    expect(run([row('tdd'), row('tdd', 'plugin')], [goal('g1', '2026-10-01T00:00:00Z')], [used('g1', '2026-10-01T01:00:00Z', 's1', ['mattpocock-skills:tdd'])]).installed.map((s) => s.usage?.sessions)).toEqual([1, 1]);
    expect(usageOf(r, 'diagnosing-bugs')).toEqual({ goals: 0, sessions: 0, lastUsedAt: null, unused: true });
  });

  test('a suite row counts only its own qualified name', () => {
    const goals = [goal('g1', '2026-10-01T00:00:00Z')];
    const others = [used('g1', '2026-10-01T01:00:00Z', 's1', ['tdd']), used('g1', '2026-10-01T02:00:00Z', 's2', ['mattpocock-skills:tdd'])];
    expect(usageOf(run([row('pstack:tdd', 'plugin')], goals, others), 'pstack:tdd', 'plugin')?.unused).toBe(true);
    const r = run([row('pstack:tdd', 'plugin')], goals, [...others, used('g1', '2026-10-01T03:00:00Z', 's3', ['pstack:tdd'])]);
    expect(usageOf(r, 'pstack:tdd', 'plugin')).toEqual({ goals: 1, sessions: 1, lastUsedAt: '2026-10-01T03:00:00Z', unused: false });
  });

  test('a leading slash on the invoked name is ignored', () => {
    const r = run([row('grill')], [goal('g1', '2026-10-01T00:00:00Z')], [used('g1', '2026-10-01T01:00:00Z', 's1', ['/grill'])]);
    expect(usageOf(r, 'grill')?.sessions).toBe(1);
  });

  test('only the newest goals by creation count, in any order given', () => {
    const goals = [goal('g2', '2026-10-02T00:00:00Z'), goal('g1', '2026-10-01T00:00:00Z'), goal('g3', '2026-10-03T00:00:00Z')];
    const r = run([row('grill'), row('tdd')], goals, [used('g1', '2026-10-01T01:00:00Z', 's1', ['grill']), used('g3', '2026-10-03T01:00:00Z', 's3', ['tdd'])], 2);
    expect(r.window).toEqual({ goals: 2, limit: 2 });
    expect(usageOf(r, 'grill')?.unused).toBe(true);
    expect(usageOf(r, 'tdd')?.goals).toBe(1);
    const seven = Array.from({ length: 7 }, (_, i) => goal(`g${i}`, `2026-10-0${i + 1}T00:00:00Z`));
    expect(run([row('tdd')], seven, []).window).toEqual({ goals: 7, limit: 30 });
  });

  test('Codex goals are left out of the window', () => {
    const r = run([row('tdd')], [goal('g1', '2026-10-01T00:00:00Z'), goal('g2', '2026-10-02T00:00:00Z', 'codex')], [used('g2', '2026-10-02T01:00:00Z', 's2', ['tdd'])]);
    expect(r.window.goals).toBe(1);
    expect(usageOf(r, 'tdd')?.unused).toBe(true);
  });

  test('no goals: usage is unknown, never unused', () => {
    const r = run([row('tdd'), row('tdd', 'plugin')], [], []);
    expect(r.window).toEqual({ goals: 0, limit: 30 });
    for (const s of r.installed) expect(s.usage).toEqual({ goals: 0, sessions: 0, lastUsedAt: null, unused: false });
  });

  test('project rows get no usage; rows keep their order and the inputs are not mutated', () => {
    const installed = [row('foundry-learnings', 'project'), row('tdd')];
    const r = run(installed, [goal('g1', '2026-10-01T00:00:00Z')], []);
    expect(r.installed.map((s) => [s.name, s.usage?.unused ?? null])).toEqual([['foundry-learnings', null], ['tdd', true]]);
    expect(usageOf(r, 'foundry-learnings', 'project')).toBeNull();
    expect(installed[1]).not.toHaveProperty('usage');
  });

  test('a session counts once when its usage event and its finished attempt both name the skill', () => {
    const log = [
      session('g1', '2026-10-01T01:00:00Z', 'a1', 's1'),
      used('g1', '2026-10-01T02:00:00Z', 's1', ['tdd']),
      finished('g1', '2026-10-01T02:00:01Z', 'a1', ['mattpocock-skills:tdd']),
      started('g2', '2026-10-02T00:30:00Z', 'a2', 's2'),
      finished('g2', '2026-10-02T01:00:00Z', 'a2', ['tdd']),
      used('g2', '2026-10-02T01:00:01Z', 's2', ['tdd']),
      used('g2', '2026-10-02T02:00:00Z', 's3', ['tdd']),
      finished('g2', '2026-10-02T03:00:00Z', 'a9', ['tdd']),
    ];
    const r = run([row('tdd')], [goal('g1', '2026-10-01T00:00:00Z'), goal('g2', '2026-10-02T00:00:00Z')], log);
    expect(usageOf(r, 'tdd')).toEqual({ goals: 2, sessions: 4, lastUsedAt: '2026-10-02T03:00:00Z', unused: false });
  });
});
