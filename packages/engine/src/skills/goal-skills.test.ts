import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineEvent } from '@foundry/core';
import { makeFakeHome, skillMd, type FakeHome } from './fake-home.test-helper.ts';
import { goalSkillsView, recordInvokedSkills, recordSkillsSeen, resolveRow, sameSkill, skillSnapshotView, snapshotPath, type GoalSkillsDeps } from './goal-skills.ts';
import { scanSkills } from './scanner.ts';

/** an event store of one goal in memory: what the record appends and reads back */
function fakeStore() {
  const events: (EngineEvent & { seq: number })[] = [];
  let seq = 0;
  let clock = Date.parse('2026-11-13T10:00:00Z');
  return {
    events,
    append(e: { type: string; goalId: string | null; payload: unknown }) {
      const full = { id: `ev_${++seq}`, ts: new Date((clock += 1000)).toISOString(), ...e, seq } as EngineEvent & { seq: number };
      events.push(full);
      return full;
    },
    listByGoalOfTypes(goalId: string, types: string[]) {
      return events.filter((e) => e.goalId === goalId && types.includes(e.type));
    },
  };
}

describe('the skills a goal saw (ADR-0098)', () => {
  let fake: FakeHome;
  let ws: string;
  let store: ReturnType<typeof fakeStore>;
  let deps: GoalSkillsDeps;
  const goal = { id: 'g1', provider: 'claude' as const, autoskills: null };

  beforeAll(() => {
    fake = makeFakeHome();
    ws = mkdtempSync(join(tmpdir(), 'foundry-goal-skills-ws-'));
    mkdirSync(join(ws, '.claude', 'skills', 'next-best-practices'), { recursive: true });
    writeFileSync(join(ws, '.claude', 'skills', 'next-best-practices', 'SKILL.md'), skillMd('next-best-practices', 'the house rules for Next.js', 'version: 1.4.0\n'));
    store = fakeStore();
    deps = { dataDir: fake.dataDir, store: store as unknown as GoalSkillsDeps['store'], rows: () => scanSkills(fake.paths).installed, paths: fake.paths, provider: 'claude', workspaceDir: ws };
  });
  afterAll(() => {
    rmSync(fake.home, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  test('a name a session used means the invoke it was given: exact, or a bare name for a prefixed copy', () => {
    expect(sameSkill('tdd', '/mattpocock-skills:tdd')).toBe(true);
    expect(sameSkill('mattpocock-skills:tdd', '/mattpocock-skills:tdd')).toBe(true);
    expect(sameSkill('pstack:tdd', '/mattpocock-skills:tdd')).toBe(false);
    expect(sameSkill('tdd', '/webapp-testing')).toBe(false);
  });

  test('an invoke resolves to the installed row with that invoke, else to a copy of that name, the user folder first', () => {
    const rows = scanSkills(fake.paths).installed;
    expect(resolveRow('/plain', rows)?.dir).toBe(join(fake.paths.skillsDir, 'plain'));
    // the fake home's `tdd` lives both in the user folder and in a plugin: the user copy is what a bare name loads
    expect(resolveRow('/tdd', rows)?.scope).toBe('user');
    expect(resolveRow('/nothing-of-the-kind', rows)).toBeNull();
  });

  test('the worker is recorded once per skill and content, its SKILL.md kept under its sha; the same prompt again records nothing', () => {
    const offered = [
      { name: 'plain', invoke: '/plain', mandate: 'must' as const, cli: null },
      { name: 'next-best-practices', invoke: '/next-best-practices', mandate: 'project' as const, cli: null },
      { name: 'rg', invoke: '/rg', mandate: 'available' as const, cli: 'rg' },
    ];
    const out = recordSkillsSeen(deps, goal, 'worker', offered);
    expect(out.map((s) => [s.invoke, s.mandate, s.source])).toEqual([
      ['/plain', 'must', 'hand'],
      ['/next-best-practices', 'project', 'project'],
    ]);
    const plain = out[0]!;
    expect(plain.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(snapshotPath(fake.dataDir, plain.sha!), 'utf8')).toBe(readFileSync(join(fake.paths.skillsDir, 'plain', 'SKILL.md'), 'utf8'));
    expect(out[1]!.version).toBe('1.4.0');
    expect(store.events.filter((e) => e.type === 'goal.skills_seen')).toHaveLength(1);
    expect(recordSkillsSeen(deps, goal, 'worker', offered)).toEqual([]);
    expect(store.events.filter((e) => e.type === 'goal.skills_seen')).toHaveLength(1);
  });

  test('another role gets its own record; a skill whose text changed is recorded again and the view counts two versions', () => {
    expect(recordSkillsSeen(deps, goal, 'reviewer-task', [{ name: 'plain', invoke: '/plain', mandate: 'prefer', cli: null }]).map((s) => s.mandate)).toEqual(['prefer']);
    writeFileSync(join(fake.paths.skillsDir, 'plain', 'SKILL.md'), skillMd('plain', 'plain, revised'));
    const again = recordSkillsSeen(deps, goal, 'worker', [{ name: 'plain', invoke: '/plain', mandate: 'must', cli: null }]);
    expect(again).toHaveLength(1);
    expect(existsSync(snapshotPath(fake.dataDir, again[0]!.sha!))).toBe(true);
    const view = goalSkillsView(deps, goal);
    const plain = view.skills.find((s) => s.invoke === '/plain')!;
    expect(plain.mandate).toBe('must');
    expect(plain.roles.sort()).toEqual(['reviewer-task', 'worker']);
    expect(plain.versions).toBe(2);
    expect(plain.sha).toBe(again[0]!.sha);
  });

  test('a skill a session invoked without being told is recorded as invoked, once; one it was told about is not recorded again', () => {
    const out = recordInvokedSkills(deps, goal, 'attempt', ['plain', 'withmanifest', 'withmanifest']);
    expect(out.map((s) => [s.invoke, s.mandate])).toEqual([['/withmanifest', 'invoked']]);
    expect(out[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(recordInvokedSkills(deps, goal, 'attempt', ['withmanifest'])).toEqual([]);
  });

  test('the view joins invocations to the skills, lists what was invoked but never recorded, and knows the old project skills by name', () => {
    const base = { provider: 'claude' as const, model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, durationMs: 1, subtype: 'success', rateLimit: null };
    store.append({ type: 'session.usage', goalId: goal.id, payload: { ...base, sessionId: 's1', kind: 'attempt', skillsUsed: ['plain', 'withmanifest'] } });
    store.append({ type: 'session.usage', goalId: goal.id, payload: { ...base, sessionId: 's2', kind: 'review-task', skillsUsed: ['plain', 'mystery'] } });
    store.append({ type: 'attempt.finished', goalId: goal.id, payload: { attemptId: 'a1', state: 'observing', resultSubtype: 'success', costUsd: 0, numTurns: 1, endRef: null, permissionDenials: [], skillsUsed: ['plain'], toolsUsed: {} } });
    const view = goalSkillsView(deps, { ...goal, autoskills: { status: 'installed', skills: ['next-best-practices', 'zod'], detail: '', at: '2026-11-13T09:00:00Z' } });
    expect(view.observable).toBe(true);
    const by = Object.fromEntries(view.skills.map((s) => [s.invoke, s]));
    expect(by['/plain']!.used).toMatchObject({ sessions: 3, roles: ['attempt', 'review-task'] });
    expect(by['/withmanifest']!.used?.sessions).toBe(1);
    expect(by['/mystery']).toMatchObject({ mandate: 'invoked', source: 'unknown', sha: null, used: { sessions: 1 } });
    // the project skill recorded with its text keeps it; the one only autoskills named is known by name
    expect(by['/next-best-practices']!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(by['/zod']).toMatchObject({ mandate: 'project', sha: null, dir: join(ws, '.claude', 'skills', 'zod') });
    expect(view.skills.map((s) => s.mandate)).toEqual(['must', 'project', 'project', 'invoked', 'invoked']);
    expect(goalSkillsView(deps, { ...goal, provider: 'codex' }).observable).toBe(false);
  });

  test('the window gets the text the goal saw and the copy installed now, which differ once the skill was edited again', () => {
    writeFileSync(join(fake.paths.skillsDir, 'plain', 'SKILL.md'), skillMd('plain', 'plain, revised twice'));
    const v = skillSnapshotView(deps, goal, '/plain')!;
    expect(v.skill.invoke).toBe('/plain');
    expect(v.snapshot!.content).toContain('plain, revised');
    expect(v.current!.content).toContain('revised twice');
    expect(v.current!.sha).not.toBe(v.snapshot!.sha);
    // a project skill's current copy is the goal workspace's
    expect(skillSnapshotView(deps, goal, '/next-best-practices')!.current!.dir).toBe(join(ws, '.claude', 'skills', 'next-best-practices'));
    expect(skillSnapshotView(deps, goal, '/never-seen')).toBeNull();
  });
});
