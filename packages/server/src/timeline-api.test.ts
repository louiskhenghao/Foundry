import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GoalTimeline, Task } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test("a goal's timeline over the API: its phases, its tasks, and a Delegated goal under the task it does", async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-timeline-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  // nothing runs in the background: the events below are the whole story
  engine.beginUpdateDrain();
  try {
    const app = createApp(engine);
    const main = await engine.createGoal({ prompt: 'a showcase site', title: 'Showcase site', repoPath: repo, nature: 'code' });
    const child = await engine.createGoal({ prompt: 'research the subject', title: 'research the subject', repoPath: repo, nature: 'research', delegatedFrom: { goalId: main.id, taskId: 't_research', title: 'Showcase site', style: null } });
    const now = new Date().toISOString();
    const task = { id: 't_research', goalId: main.id, title: 'research the subject', spec: 's', kind: 'goal', scope: null, scenario: 'research', area: null, tdd: 'off', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'running', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'goal.state_changed', goalId: main.id, payload: { from: 'draft', to: 'clarifying', reason: 'test' } });
    engine.store.append({ type: 'goal.state_changed', goalId: main.id, payload: { from: 'clarifying', to: 'running', reason: 'test' } });
    engine.store.append({ type: 'task.created', goalId: main.id, payload: { task } });
    engine.store.append({ type: 'task.delegated', goalId: main.id, payload: { taskId: task.id, goalId: child.id, title: task.title } });
    const r = await app.request(`/api/goals/${main.id}/timeline`);
    expect(r.status).toBe(200);
    const t = (await r.json()) as GoalTimeline;
    expect(t.live).toBe(true);
    expect(t.rows.map((row) => [row.level, row.kind, row.label])).toEqual([
      [0, 'goal', 'Showcase site'],
      [1, 'task', 'research the subject'],
      [1, 'delegated', 'Delegated goal: research the subject'],
    ]);
    // the goal works: its last phase runs to now
    expect(t.rows[0]!.spans.at(-1)).toMatchObject({ kind: 'run', open: true });
    expect(t.rows[1]!.spans).toMatchObject([{ kind: 'run', label: 'Delegated goal: research the subject', open: true }]);
    expect((await app.request('/api/goals/g_nope/timeline')).status).toBe(404);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  }
});
