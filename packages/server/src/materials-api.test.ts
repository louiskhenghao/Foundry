import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief } from '@foundry/core';
import { getBrief, getGoal, listEscalations, listTasks } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { makeRepo, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let home: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-materials-api-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [home, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});

/** a worker that asks for the models the first time and finishes once resumed */
class Worker implements ClaudeRunner {
  calls: RunSpec[] = [];
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const resumed = !!spec.resumeSessionId;
    if (resumed) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    const sessionId = spec.resumeSessionId ?? `s${this.calls.length}`;
    const finalText = resumed ? 'done' : 'Built it.\n\n```foundry-needs\n{ "what": "the car models", "why": "the showroom", "suggestions": "glTF", "canProceedWithout": false }\n```';
    const result: RunResult = { sessionId, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText, structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const task = (key: string, title: string, extra: Partial<Brief['tasks'][number]> = {}): Brief['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null, ...extra });
const brief = (tasks: Brief['tasks'], provides: Brief['provides'] = []): Omit<Brief, 'goalId'> => ({ title: '', understanding: 'u', styleOptions: [], areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks, checks: [{ key: 'C1', name: 'done', tier: 'must', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd: 'test -f done.txt', timeoutMs: 60_000, expectExitCode: 0 } }], provides });
const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const upload = async (app: ReturnType<typeof createApp>, name: string) => {
  const form = new FormData();
  form.append('files', new File([new Uint8Array([1, 2, 3])], name, { type: 'application/octet-stream' }));
  return (await (await app.request('/api/uploads', { method: 'POST', body: form })).json()).attachments[0];
};

test("a Request is answered through the Inbox route with words and staged files, which become the goal's attachments marked with it", async () => {
  const runner = new Worker();
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {} }), runner);
  engines.push(engine);
  const app = createApp(engine);
  const goal = await engine.createGoal({ prompt: 'a showroom', repoPath: repo, brief: brief([task('T1', 'build it')]) });
  await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
  const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
  const staged = await upload(app, 'car.glb');
  const answered = await post(app, `/api/escalations/${esc.id}/answer`, { action: 'provide', hint: 'one car for now', attachments: [staged] });
  expect(answered.status).toBe(200);
  const att = getGoal(engine.store.db, goal.id)!.attachments.find((a) => a.name === 'car.glb')!;
  expect(att.requestId).toBe(esc.id);
  const served = await app.request(`/api/goals/${goal.id}/attachments/${att.id}`);
  expect(served.status).toBe(200);
  await waitFor(() => listTasks(engine.store.db, goal.id)[0]!.state === 'done', 30_000);
  expect(runner.calls[1]!.resumeSessionId).toBe('s1');
}, 90_000);

test('a material promised in the Brief is given on its own route, with files or as "I have none"', async () => {
  const runner = new Worker();
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {} }), runner);
  engines.push(engine);
  const app = createApp(engine);
  const provides: Brief['provides'] = [
    { key: 'M1', what: 'the logos', neededBy: ['T1'], mode: 'wait', status: 'waiting', receivedAt: null, attachmentIds: [], note: null },
    { key: 'M2', what: 'the copy', neededBy: [], mode: 'wait', status: 'waiting', receivedAt: null, attachmentIds: [], note: null },
  ];
  const goal = await engine.createGoal({ prompt: 'a brand page', repoPath: repo, brief: brief([task('T1', 'build it', { needs: ['M1'] })], provides) });
  await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input'), 30_000);
  const staged = await upload(app, 'logo.svg');
  const r = await post(app, `/api/goals/${goal.id}/materials/M1`, { attachments: [staged], note: 'final' });
  expect(r.status).toBe(200);
  expect((await r.json()).brief.provides[0].status).toBe('received');
  expect((await post(app, `/api/goals/${goal.id}/materials/M2`, { waived: true, note: 'none yet' })).status).toBe(200);
  expect((await post(app, `/api/goals/${goal.id}/materials/M9`, {})).status).toBe(400);
  const b = getBrief(engine.store.db, goal.id)!.brief;
  expect(b.provides!.map((p) => p.status)).toEqual(['received', 'waived']);
  expect(getGoal(engine.store.db, goal.id)!.attachments[0]!.materialKey).toBe('M1');
  expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })).toHaveLength(0);
}, 90_000);
