import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Attempt, EngineEvent } from '@foundry/core';
import { getBrief, listTasks } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, waitFor } from '../test-helpers.ts';
import { FakeMemoryBackend } from './fake-backend.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** an engine with Memory on, a fake server behind it, and a goal with an approved Brief whose tasks never start */
async function setup(over: { retainTranscripts?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-memory-pipe-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  // no session starts: the events below are appended by hand, as the engine would append them
  engine.beginUpdateDrain();
  const fake = new FakeMemoryBackend();
  engine.memoryDeps = { backend: () => fake, reflectTimeoutMs: 200, retainTimeoutMs: 500 };
  engine.updateSettings({ memory: { url: 'http://127.0.0.1:1', ...over } });
  cleanups.push(async () => {
    await engine.stop();
    for (const p of [dataDir, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
  });
  const goal = await engine.createGoal({ prompt: 'Add a dark mode to the settings page', title: 'Add dark mode', repoPath: repo, nature: 'code', autoBrief: { mustChecks: [] } });
  const task = listTasks(engine.store.db, goal.id)[0]!;
  // the first write makes the bank ready and seeds it from the repository's commits in the background: those documents are not what a test looks at
  const docs = () => fake.all().filter((d) => !d.documentId?.startsWith('git:'));
  return { engine, repo, fake, goal, task, dataDir, docs };
}
const SLOW = 20_000;

describe('what a goal writes into its folder\'s Memory', () => {
  test("a task review's verdict, a replan's reason and a second opinion, each as one document tagged with its stage", async () => {
    const { engine, fake, goal, task, docs } = await setup();
    const now = new Date().toISOString();
    engine.store.append({ type: 'review.task.finished', goalId: goal.id, payload: { attemptId: 'att_r1', taskId: task.id, verdict: { pass: false, blockers: ['No test covers the toggle.'], notes: 'Otherwise fine.' } } });
    engine.store.append({ type: 'task.revised', goalId: goal.id, payload: { taskId: task.id, spec: 'Read the theme from settings.json instead.', relevantFiles: null, delivers: null, reason: 'the theme lives in settings.json', afterTaskId: null } });
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    engine.store.append({ type: 'brief.second_opinion', goalId: goal.id, payload: { auto: false, costUsd: 0.1, changeSummary: 'Split the toggle from the persistence.', revised: brief } });
    await waitFor(() => docs().length >= 3);
    const review = fake.find(`goal:${goal.id}:review:att_r1`)!;
    expect(review.content).toContain('refused');
    expect(review.content).toContain('- No test covers the toggle.');
    expect(review.tags).toEqual(expect.arrayContaining(['source:foundry', `goal:${goal.id}`, 'stage:review', `task:${task.id}`, 'verdict:fail']));
    const replan = docs().find((d) => d.documentId?.startsWith(`goal:${goal.id}:replan:${task.id}:`))!;
    expect(replan.content).toContain('because the theme lives in settings.json');
    expect(replan.tags).toContain('stage:plan');
    const opinion = docs().find((d) => d.documentId?.startsWith(`goal:${goal.id}:second-opinion:`))!;
    expect(opinion.content).toContain('Split the toggle from the persistence.');
    expect(opinion.tags).toContain('stage:brief');
    // each write is on the goal's record
    const retained = engine.store.listByGoalOfTypes(goal.id, ['memory.retained']);
    expect(retained.map((e) => (e.payload as { source: string }).source).sort()).toEqual(['brief', 'plan', 'review']);
    expect(retained.find((e) => (e.payload as { source: string }).source === 'review')).toMatchObject({ payload: { taskId: task.id, attemptId: 'att_r1', count: 1, error: null } });
    expect(now <= new Date().toISOString()).toBe(true);
  }, SLOW);

  test("a revised Brief: what changed against the Brief as it was, numbered; an edit that changes nothing writes nothing", async () => {
    const { engine, fake, goal, docs } = await setup();
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    engine.store.append({ type: 'brief.edited', goalId: goal.id, payload: { brief } });
    engine.store.append({ type: 'brief.edited', goalId: goal.id, payload: { brief: { ...brief, understanding: `${brief.understanding}\nAlso: the toggle must remember its state across reloads.` } } });
    await waitFor(() => docs().length >= 1);
    expect(docs()).toHaveLength(1);
    const doc = fake.find(`goal:${goal.id}:brief:2`)!;
    expect(doc.content).toContain('revision 2');
    expect(doc.content).toContain('understanding after');
    expect(doc.content).toContain('remember its state across reloads');
    expect(doc.tags).toContain('stage:brief');
  }, SLOW);

  test("an attempt's transcript goes in compact, with how it ended; not when the switch is off", async () => {
    const { engine, fake, goal, task, dataDir, docs } = await setup();
    const transcriptPath = join(dataDir, 'transcripts', 'att_t1.jsonl');
    mkdirSync(dirname(transcriptPath), { recursive: true });
    writeFileSync(transcriptPath.replace(/\.jsonl$/, '.prompt.md'), '# Your task\nAdd the toggle.');
    writeFileSync(
      transcriptPath,
      [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'plan: add the toggle' }, { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/settings.tsx', old_string: 'a', new_string: 'b' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] } },
        { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, num_turns: 2, duration_ms: 10, result: 'done' },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n'),
    );
    const attempt: Attempt = { id: 'att_t1', goalId: goal.id, taskId: task.id, index: 1, kind: 'work', sessionId: null, model: 'fake', state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath, startedAt: new Date().toISOString(), endedAt: null, skillsUsed: [], continuations: 0, sessions: [] };
    engine.store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt } });
    engine.store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: 'att_t1', state: 'passed', reason: 'all must checks passed' } });
    await waitFor(() => docs().length >= 1);
    const doc = fake.find(`goal:${goal.id}:attempt:att_t1`)!;
    const turns = doc.content.split('\n').map((l) => JSON.parse(l));
    expect(turns).toEqual([
      { role: 'user', content: '# Your task\nAdd the toggle.' },
      { role: 'assistant', content: 'plan: add the toggle' },
      { role: 'action', content: 'Edit src/settings.tsx' },
      { role: 'result', content: 'success' },
    ]);
    expect(doc.context).toContain(`"${task.title}"`);
    expect(doc.context).toContain('ended passed');
    expect(doc.tags).toEqual(expect.arrayContaining(['source:transcript', `goal:${goal.id}`, `task:${task.id}`, 'attempt:att_t1', 'outcome:passed']));

    // the switch off: the next attempt writes nothing
    engine.updateSettings({ memory: { retainTranscripts: false } });
    engine.store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt: { ...attempt, id: 'att_t2' } } });
    engine.store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: 'att_t2', state: 'passed', reason: 'all must checks passed' } });
    await engine.stop();
    expect(fake.find(`goal:${goal.id}:attempt:att_t2`)).toBeUndefined();
  }, SLOW);

  test("a goal that ended writes its record; the folder's Learnings follow in place of the earlier notebook", async () => {
    const { engine, fake, goal, docs } = await setup();
    // the ending, handed to Memory as the engine's subscriber hands it (the engine's own end-of-goal work stays out of this test)
    const ended: EngineEvent = { id: 'evt_test', ts: new Date().toISOString(), goalId: goal.id, type: 'goal.state_changed', payload: { from: 'running', to: 'done', reason: 'every task done' } };
    engine.memory.onEvent(ended);
    engine.setLearnings(goal.repoPath, [{ kind: 'build', text: 'Run bun install first.' }]);
    engine.setLearnings(goal.repoPath, [{ kind: 'build', text: 'Run bun install first.' }, { kind: 'pitfall', text: 'The theme toggle must persist.' }]);
    await waitFor(() => docs().length >= 3);
    const record = fake.find(`goal:${goal.id}:record`)!;
    expect(record.content).toContain('"Add dark mode"');
    expect(record.tags).toEqual(expect.arrayContaining(['source:foundry', 'stage:goal']));
    const notebooks = docs().filter((d) => d.documentId === 'learnings:notebook');
    expect(notebooks).toHaveLength(2);
    expect(notebooks[1]!.updateMode).toBe('replace');
    expect(notebooks[1]!.content).toContain('- [pitfall] The theme toggle must persist. (the person wrote this)');
    expect(notebooks[1]!.tags).toEqual(['source:learnings']);
  }, SLOW);

  test('a folder left out writes nothing, whatever happens in it', async () => {
    const { engine, fake, goal, task, docs } = await setup();
    engine.memory.setFolder(goal.repoPath, false);
    engine.store.append({ type: 'review.task.finished', goalId: goal.id, payload: { attemptId: 'att_x', taskId: task.id, verdict: { pass: true, blockers: [] } } });
    engine.setLearnings(goal.repoPath, [{ kind: 'build', text: 'Run bun install first.' }]);
    await engine.stop();
    expect(docs()).toEqual([]);
    expect(fake.questions).toEqual([]);
  }, SLOW);
});
