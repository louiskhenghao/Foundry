import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getGoal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { makeRepo, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let home: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-conversation-api-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [home, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});

const areas = [{ key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' }];
const task = (key: string, title: string): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const full: BriefOutput = { title: 'feat(portal): build the student portal', understanding: 'One portal.', nature: 'code', areas, assumptions: ['a'], tasks: [task('T1', 'add student home')], checks: [{ key: 'C1', name: 'C1', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'true', rubric: null }], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null };

/** answers Clarify and the classifier at once, and every Explainer turn with one line */
class LabelRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const label = spec.label ?? '';
    const chat = label.startsWith('conversation');
    const out = label.startsWith('classify nature') ? { nature: 'code' } : chat ? null : full;
    const text = chat ? 'It reads the table the first task makes.' : JSON.stringify(out);
    const result: RunResult = { sessionId: spec.resumeSessionId ?? `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: text, structuredOutput: out, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, ...(chat ? [{ kind: 'text', text } as RunnerEvent] : []), { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const make = (beta: boolean) => {
  const runner = new LabelRunner();
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {}, betaConversation: beta }), runner);
  engines.push(engine);
  return { runner, engine, app: createApp(engine) };
};
const post = (app: ReturnType<typeof createApp>, path: string, body?: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test('a question is kept at once (202) and answered in the background; the view carries the Conversation and what is live', async () => {
  const { engine, app, runner } = make(true);
  const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  let view = await (await app.request(`/api/goals/${goal.id}/conversations`)).json();
  expect(view).toEqual({ enabled: true, conversations: [], live: {} });

  const asked = await post(app, `/api/goals/${goal.id}/conversations/ask`, { text: 'What does T1 do?' });
  expect(asked.status).toBe(202);
  const { conversationId, messageId, channel } = await asked.json();
  expect(channel).toBe(`conversation-${conversationId}`);
  await waitFor(() => engine.conversations.view(goal.id).conversations[0]?.messages.length === 2, 30_000);
  view = await (await app.request(`/api/goals/${goal.id}/conversations`)).json();
  expect(view.conversations).toHaveLength(1);
  expect(view.conversations[0].messages.map((m: { role: string; status: string | null }) => [m.role, m.status])).toEqual([['person', null], ['explainer', 'done']]);
  expect(view.conversations[0].messages[1].askedId).toBe(messageId);
  expect(view.conversations[0].messages[1].text).toBe('It reads the table the first task makes.');
  expect(view.live[conversationId]).toEqual({ answering: null, queued: [] });
  expect(runner.calls.filter((c) => c.label?.startsWith('conversation'))).toHaveLength(1);

  // nothing running: Stop has nothing to stop; a question with no words is refused; a goal that is not there is not found
  expect(await (await post(app, `/api/goals/${goal.id}/conversations/${conversationId}/stop`)).json()).toEqual({ stopped: false });
  expect((await post(app, `/api/goals/${goal.id}/conversations/ask`, { text: '   ' })).status).toBe(400);
  expect((await post(app, `/api/goals/nope/conversations/ask`, { text: 'hi' })).status).toBe(404);
  expect((await post(app, `/api/goals/${goal.id}/conversations/c_nope/stop`)).status).toBe(404);
}, 60_000);

test('off until Settings → Beta switches it on: the view says so and a question is refused (409)', async () => {
  const { engine, app } = make(false);
  const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  expect((await (await app.request(`/api/goals/${goal.id}/conversations`)).json()).enabled).toBe(false);
  const refused = await post(app, `/api/goals/${goal.id}/conversations/ask`, { text: 'why?' });
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain('Settings → Beta');
}, 30_000);

test("a question's attachments: the staged uploads go with the ask, and the file is served like the goal's own", async () => {
  const { engine, app } = make(true);
  const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  const form = new FormData();
  form.append('files', new File([new Uint8Array([1, 2, 3, 4])], 'shot.png', { type: 'image/png' }));
  const up = await app.request('/api/uploads', { method: 'POST', body: form });
  expect(up.status).toBe(201);
  const { attachments: [staged] } = await up.json();
  const asked = await post(app, `/api/goals/${goal.id}/conversations/ask`, { text: 'What is this?', attachments: [staged] });
  expect(asked.status).toBe(202);
  const view = await (await app.request(`/api/goals/${goal.id}/conversations`)).json();
  expect(view.conversations[0].messages[0].attachments.map((a: { name: string }) => a.name)).toEqual(['shot.png']);
  const served = await app.request(`/api/goals/${goal.id}/attachments/${staged.id}`);
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect((await app.request(`/api/goals/${goal.id}/attachments/att_nope`)).status).toBe(404);
  await waitFor(() => engine.conversations.view(goal.id).conversations[0]?.messages.length === 2, 30_000);
}, 60_000);
