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
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-second-opinion-api-'));
  repo = await makeRepo();
});
afterEach(() => {
  for (const p of [home, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
});

const areas = [{ key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' }];
const task = (key: string, title: string, deps: string[] = []): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: deps, parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const check = (key: string, taskKey: string | null): BriefOutput['checks'][number] => ({ key, name: key, tier: 'must', taskKey, areaKey: null, type: 'command', cmd: 'true', rubric: null });
const full: BriefOutput = { title: 'feat(portal): build the student portal', understanding: 'One portal.', nature: 'code', areas, assumptions: ['a'], tasks: [task('T1', 'add student home')], checks: [check('C1', 'T1')], costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null };
const { openQuestions: _q, ...revisable } = full;
const opinion = { ...revisable, tasks: [task('T1', 'add student home'), task('T4', 'add student grades', ['T1'])], checks: [check('C1', 'T1'), check('C4', 'T4')], changeSummary: 'Added the grades page the goal implies.', newQuestions: [] };

/** answers each session by its label; the second opinion waits until the test lets it through */
class GatedRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private gate: Promise<void>) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    if (spec.label?.startsWith('second opinion')) await this.gate;
    const structuredOutput = spec.label?.startsWith('classify nature') ? { nature: 'code' } : spec.label?.startsWith('clarify') ? full : spec.label?.startsWith('second opinion') ? opinion : null;
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

test('a second opinion is started (202) and followed through the goal detail: being written, one at a time, then kept', async () => {
  let release!: () => void;
  const runner = new GatedRunner(new Promise<void>((r) => (release = r)));
  const engine = new Engine(defaultConfig(ROOT, { dataDir: home, claudeHome: join(home, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {} }), runner);
  const app = createApp(engine);
  const post = (path: string) => app.request(path, { method: 'POST' });
  try {
    const goal = await engine.createGoal({ prompt: 'a student portal', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const started = await post(`/api/goals/${goal.id}/brief/second-opinion`);
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual({ started: true });
    let detail = await (await app.request(`/api/goals/${goal.id}`)).json();
    expect(detail.secondOpinionRunning).toBe(true);
    expect(detail.secondOpinion).toBeNull();
    expect(detail.secondOpinionFailed).toBeNull();
    const again = await post(`/api/goals/${goal.id}/brief/second-opinion`);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('a second opinion is already being written');
    release();
    await waitFor(() => !!engine.secondOpinionOf(goal.id));
    detail = await (await app.request(`/api/goals/${goal.id}`)).json();
    expect(detail.secondOpinionRunning).toBe(false);
    expect(detail.secondOpinion.proposal.revision.diff.tasks.added.map((t: { key: string }) => t.key)).toEqual(['T4']);
    expect(detail.secondOpinionFailed).toBeNull();
    expect((await post('/api/goals/g_nobody/brief/second-opinion')).status).toBe(404);
  } finally {
    await engine.stop();
  }
}, 30_000);
