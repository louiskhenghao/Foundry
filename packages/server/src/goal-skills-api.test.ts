import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import type { GoalSkillsView, SkillSnapshotView } from '@foundry/engine/skills-types';
import { makeFakeHome, skillMd } from '../../engine/src/skills/fake-home.test-helper.ts';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

/** the skills a goal saw (ADR-0098) over HTTP: the goal view lists them, the window route opens one as the goal saw it */
describe('a goal view carries the skills its sessions were given', () => {
  const fake = makeFakeHome();
  let repo: string;
  let engine: Engine;
  let goalId: string;

  beforeAll(async () => {
    repo = await makeRepo();
    engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { provider: 'claude', dataDir: fake.dataDir, claudeHome: fake.claudeHome, codexHome: join(fake.home, '.codex'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const goal = await engine.createGoal({ prompt: 'a', repoPath: repo, nature: 'code' });
    goalId = goal.id;
    // a worker's section: the fake home has `tdd` installed, so the suite's feature rule names it
    const section = await engine.skillsSection(goal, 'worker', { taskKind: 'feature' });
    expect(section).toContain('tdd');
    // a session that invoked a skill of the machine no prompt named
    engine.recordSessionUsage({ sessionId: 's1', subtype: 'success', isError: false, costUsd: 0, numTurns: 1, durationMs: 1, skillsUsed: ['plain'], toolsUsed: {}, permissionDenials: [], rateLimit: null, result: '', usage: null, modelUsage: null, errorMessage: null, failureClass: null } as never, { goalId, kind: 'attempt' });
  });
  afterAll(async () => {
    await engine.stop();
    rmSync(fake.home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  });

  test('the goal view lists the worker\'s tdd with its text kept, and the invoked skill as invoked', async () => {
    const r = await createApp(engine).request(`/api/goals/${goalId}`);
    expect(r.status).toBe(200);
    const { skills } = (await r.json()) as { skills: GoalSkillsView };
    expect(skills.observable).toBe(true);
    const tdd = skills.skills.find((s) => s.name === 'tdd')!;
    expect(tdd).toMatchObject({ mandate: 'must', roles: ['worker'] });
    expect(tdd.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(skills.skills.find((s) => s.invoke === '/plain')).toMatchObject({ mandate: 'invoked', used: { sessions: 1 } });
  });

  test('the window route gives the text the goal saw beside the copy installed now, and 404 for a skill the goal never saw', async () => {
    const app = createApp(engine);
    const before = (await (await app.request(`/api/goals/${goalId}/skills/view?invoke=${encodeURIComponent('/plain')}`)).json()) as SkillSnapshotView;
    expect(before.snapshot!.content).toBe(readFileSync(join(fake.paths.skillsDir, 'plain', 'SKILL.md'), 'utf8'));
    expect(before.current!.sha).toBe(before.snapshot!.sha);
    writeFileSync(join(fake.paths.skillsDir, 'plain', 'SKILL.md'), skillMd('plain', 'edited after the goal'));
    const after = (await (await app.request(`/api/goals/${goalId}/skills/view?invoke=${encodeURIComponent('/plain')}`)).json()) as SkillSnapshotView;
    expect(after.snapshot!.sha).toBe(before.snapshot!.sha);
    expect(after.current!.content).toContain('edited after the goal');
    expect((await app.request(`/api/goals/${goalId}/skills/view?invoke=${encodeURIComponent('/never')}`)).status).toBe(404);
  });
});
