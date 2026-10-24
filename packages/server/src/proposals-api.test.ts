import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief } from '@foundry/core';
import { listTasks, newId } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { makeRepo, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let home: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-proposals-api-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [home, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});
/** a worker held on the second task, so the goal stays at work */
class Runner implements ClaudeRunner {
  release!: () => void;
  private held = new Promise<void>((r) => (this.release = r));
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    if (spec.prompt.includes('# Your task (second)')) await this.held;
    writeFileSync(join(spec.cwd, spec.prompt.includes('# Your task (second)') ? 'two.txt' : 'done.txt'), 'ok');
    const result: RunResult = { sessionId: 's1', subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: 'done', structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: 's1', model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const task = (key: string, title: string, extra: Partial<Brief['tasks'][number]> = {}): Brief['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null, ...extra });
const check = (key: string, taskKey: string, file: string): Brief['checks'][number] => ({ key, name: file, tier: 'must', taskKey, areaKey: null, spec: { type: 'command', cmd: `test -f ${file}`, timeoutMs: 60_000, expectExitCode: 0 } });

test('a proposal is applied on its route, once; an unknown one is not found', async () => {
  const runner = new Runner();
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {}, betaConversation: true }), runner);
  engines.push(engine);
  const app = createApp(engine);
  const goal = await engine.createGoal({ prompt: 'orders', repoPath: repo, brief: { title: '', understanding: 'u', styleOptions: [], areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [task('T1', 'first'), task('T2', 'second', { dependsOnKeys: ['T1'] })], checks: [check('C1', 'T1', 'done.txt'), check('C2', 'T2', 'two.txt')], provides: [] } });
  await waitFor(() => listTasks(engine.store.db, goal.id).find((t) => t.title === 'second')?.state === 'running', 30_000);
  const cid = newId('conversation');
  const asked = newId('message');
  engine.store.append({ type: 'conversation.started', goalId: goal.id, payload: { conversationId: cid, by: null } });
  engine.store.append({ type: 'conversation.asked', goalId: goal.id, payload: { conversationId: cid, messageId: asked, text: 'add it', by: null } });
  engine.store.append({ type: 'conversation.answered', goalId: goal.id, payload: { conversationId: cid, messageId: newId('message'), askedId: asked, text: 'ok', status: 'done', reason: null, costUsd: 0, costAvailable: false, model: null, sessionId: null, durationMs: 0, proposals: [{ id: 'prop_1', type: 'task', title: 'Add it', summary: '', task: { title: 'add it', spec: 'do it', kind: 'chore', scenario: 'general', difficulty: 'simple', dependsOn: [], relevantFiles: [], checks: [] }, applied: null }] } });
  const post = (path: string) => app.request(path, { method: 'POST' });
  const r = await post(`/api/goals/${goal.id}/conversations/${cid}/proposals/prop_1/apply`);
  expect(r.status).toBe(200);
  expect((await r.json()).result).toMatch(/^task t_[a-z0-9]+: add it$/);
  expect((await post(`/api/goals/${goal.id}/conversations/${cid}/proposals/prop_1/apply`)).status).toBe(409);
  expect((await post(`/api/goals/${goal.id}/conversations/${cid}/proposals/prop_9/apply`)).status).toBe(404);
  const view = await (await app.request(`/api/goals/${goal.id}/conversations`)).json();
  expect(view.conversations[0].messages[1].proposals[0].applied.result).toContain('add it');
  runner.release();
}, 90_000);
