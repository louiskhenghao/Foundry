import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@ai-engine/core';
import { getBrief, getGoal, listTasks } from '@ai-engine/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@ai-engine/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ai-engine-clarify-'));
  repo = await makeRepo();
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** Runner that answers every session with a scripted structured output, chosen by call index. */
class StructuredRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private answers: (spec: RunSpec, n: number) => unknown) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = this.answers(spec, this.calls.length);
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const areas = [
  { key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' },
  { key: 'A2', name: 'Teacher portal', slug: 'teacher-portal', description: 'what teachers see' },
];
const task = (key: string, areaKey: string, title: string, deps: string[] = []): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', areaKey, dependsOnKeys: deps, parallelizable: true, relevantFiles: ['README.md'] });
const check = (key: string, taskKey: string | null, areaKey: string | null = null): BriefOutput['checks'][number] => ({ key, name: key, tier: 'must', taskKey, areaKey, type: 'command', cmd: 'true', rubric: null });
const briefWith = (tasks: BriefOutput['tasks'], checks: BriefOutput['checks']): BriefOutput => ({ title: 'feat(portal): build portals', understanding: 'Two portals.', nature: 'code', areas, assumptions: ['a'], tasks, checks, costEstimateUsd: 4, timeEstimateMin: 30, questions: [] });

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

describe('clarify coverage gate', () => {
  test('an Area without tasks triggers one repair turn in the same session; the repaired Brief is kept', async () => {
    const runner = new StructuredRunner((spec, n) => (n === 1 ? briefWith([task('T1', 'A1', 'add student home')], [check('C1', 'T1'), check('G1', null, 'A1')]) : briefWith([task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1'])], [check('C1', 'T1'), check('C2', 'T2'), check('G1', null, 'A1')])));
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[1]!.resumeSessionId).toBe('s1');
    expect(runner.calls[1]!.prompt).toContain('"Teacher portal" (A2)');
    expect(runner.calls[0]!.prompt).toContain('every Area MUST have at least one task');
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    expect(brief.areas.map((a) => a.key)).toEqual(['A1', 'A2']);
    expect(brief.tasks.map((t) => [t.key, t.areaKey])).toEqual([['T1', 'A1'], ['T2', 'A2']]);
    expect(brief.checks.find((c) => c.key === 'G1')).toMatchObject({ taskKey: null, areaKey: 'A1' });
    expect(brief.questions.filter((q) => q.areaKey)).toHaveLength(0);
    const cost = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added').map((e) => (e.payload as { source: string }).source);
    expect(cost).toEqual(['clarify', 'clarify-coverage']);

    // approval materialises the Area name and the slug as default commit scope
    await engine.approveBrief(goal.id);
    const tasks = listTasks(engine.store.db, goal.id);
    expect(tasks.map((t) => [t.area, t.scope])).toEqual([
      ['Student portal', 'student-portal'],
      ['Teacher portal', 'teacher-portal'],
    ]);
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('still uncovered after the repair → a non-blocking Question tagged with the Area', async () => {
    const runner = new StructuredRunner(() => briefWith([task('T1', 'A1', 'add student home')], [check('C1', 'T1')]));
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls).toHaveLength(2);
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    const q = brief.questions.find((q) => q.areaKey === 'A2')!;
    expect(q.blocking).toBe(false);
    expect(q.text).toContain('Teacher portal');
    // not blocking: the Brief can still be approved
    await engine.approveBrief(goal.id);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('running');
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);
});

describe('draft with AI', () => {
  test('task mode fills the empty fields and proposes checks; acceptance mode proposes checks only; area mode proposes tasks', async () => {
    const full = briefWith([task('T1', 'A1', 'add student home')], [check('C1', 'T1')]);
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('clarify')) return { ...full, tasks: [...full.tasks, task('T9', 'A2', 'placeholder')] };
      if (spec.label?.startsWith('draft area')) return { tasks: [task('N1', 'A2', 'add teacher home'), task('N2', 'A2', 'add grading view', ['N1'])], checks: [check('X1', 'N1'), check('X2', null)], rationale: 'two slices' };
      return { spec: spec.label?.startsWith('draft acceptance') ? null : '## Do it\nbuild the page', kind: 'feature', scope: null, scenario: 'frontend', areaKey: 'A2', tdd: 'inherit' as const, dependsOnKeys: ['T1', 'nope'], relevantFiles: ['README.md'], checks: [{ name: 'renders', tier: 'must', type: 'reviewer', cmd: null, rubric: 'page renders' }], rationale: 'because' };
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const { goalId: _g, ...brief } = getBrief(engine.store.db, goal.id)!.brief;
    // the page adds an empty task (unsaved) and asks for a draft
    const draft = { ...brief, tasks: [...brief.tasks, { key: 'T2', title: 'add teacher home', spec: '', kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: [], parallelizable: true, relevantFiles: [] }] };
    const p = await engine.draftBrief(goal.id, { mode: 'task', brief: draft, taskKey: 'T2', areaKey: null, notes: 'reuse the student layout' });
    expect(p.task).toEqual({ spec: '## Do it\nbuild the page', kind: 'feature', scenario: 'frontend', scope: null, areaKey: 'A2', dependsOnKeys: ['T1'], relevantFiles: ['README.md'] });
    expect(p.checks).toHaveLength(1);
    expect(p.checks[0]).toMatchObject({ key: 'C2', taskKey: 'T2', tier: 'must', spec: { type: 'reviewer', scope: 'task-diff', rubric: 'page renders' } });
    expect(p.costUsd).toBe(0.5);
    const last = runner.calls.at(-1)!;
    expect(last.prompt).toContain('reuse the student layout');
    expect(last.prompt).toContain('T1 [Student portal');
    expect(last.resumeSessionId).toBeUndefined();

    const a = await engine.draftBrief(goal.id, { mode: 'acceptance', brief: draft, taskKey: 'T2', areaKey: null, notes: '' });
    expect(a.task).toBeNull();
    expect(a.checks[0]!.taskKey).toBe('T2');

    const ar = await engine.draftBrief(goal.id, { mode: 'area', brief, taskKey: null, areaKey: 'A2', notes: '' });
    // keys renumbered after the Brief's highest (T9 exists) and dependencies remapped
    expect(ar.tasks.map((t) => [t.key, t.areaKey, t.dependsOnKeys])).toEqual([
      ['T10', 'A2', []],
      ['T11', 'A2', ['T10']],
    ]);
    expect(ar.checks.map((c) => [c.key, c.taskKey, c.areaKey])).toEqual([
      ['C2', 'T10', null],
      ['C3', null, 'A2'],
    ]);
    const sources = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added').map((e) => (e.payload as { source: string }).source);
    expect(sources.filter((s) => s === 'draft')).toHaveLength(3);
    // the Brief itself was not touched
    expect(getBrief(engine.store.db, goal.id)!.brief.tasks).toHaveLength(2);

    await engine.approveBrief(goal.id);
    await expect(engine.draftBrief(goal.id, { mode: 'acceptance', brief, taskKey: 'T1', areaKey: null, notes: '' })).rejects.toThrow(/only possible while the Brief awaits approval/);
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);
});

describe('decisions', () => {
  test('revise returns a keyed diff; decisions reach the worker prompt; re-run Clarify carries them', async () => {
    const full = briefWith([task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1']), task('T3', 'A2', 'add grading', ['T2'])], [check('C1', 'T1'), check('C2', 'T2'), check('G1', null)]);
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('clarify')) return { ...full, questions: [{ text: 'Teachers too?', blocking: true, areaKey: 'A2' }] };
      if (spec.label?.startsWith('draft revise')) {
        const { questions: _q, ...rest } = full;
        return { ...rest, understanding: 'Students only.', areas: [full.areas[0]], tasks: [task('T1', 'A1', 'add student home'), task('T4', 'A1', 'add student grades', ['T1'])], checks: [check('C1', 'T1', null), check('C9', 'T4')], changeSummary: 'Dropped the teacher tasks because the human said students only.', newQuestions: [] };
      }
      return null;
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const { goalId: _g, ...brief } = getBrief(engine.store.db, goal.id)!.brief;
    const q = brief.questions.find((x) => x.text === 'Teachers too?')!;
    const answered = { ...brief, questions: brief.questions.map((x) => (x.id === q.id ? { ...x, answer: 'No, students only' } : x)), assumptions: [{ id: brief.assumptions[0]!.id, text: brief.assumptions[0]!.text, accepted: false, applied: false }] };

    const p = await engine.draftBrief(goal.id, { mode: 'revise', brief: answered, taskKey: null, areaKey: null, notes: '' });
    const d = p.revision!.diff;
    expect(d.tasks.added.map((t) => t.key)).toEqual(['T4']);
    expect(d.tasks.removed.map((t) => t.key).sort()).toEqual(['T2', 'T3']);
    expect(d.tasks.changed).toEqual([]);
    expect(d.checks.removed.map((c) => c.key).sort()).toEqual(['C2', 'G1']);
    expect(d.areas.removed.map((a) => a.key)).toEqual(['A2']);
    expect(d.understanding?.after).toBe('Students only.');
    expect(p.revision!.revised.questions.find((x) => x.id === q.id)?.answer).toBe('No, students only');
    // the rejected assumption survives the revision even though the model dropped it
    expect(p.revision!.revised.assumptions.some((a) => !a.accepted)).toBe(true);
    const prompt = runner.calls.at(-1)!.prompt;
    expect(prompt).toContain('## Decisions from the human');
    expect(prompt).toContain('A: No, students only');
    expect(prompt).toContain('Rejected assumption');
    expect(engine.store.listByGoal(goal.id, 5000).some((e) => e.type === 'goal.cost_added' && (e.payload as { source: string }).source === 'revise')).toBe(true);

    // re-run Clarify keeps the decisions
    engine.editBrief(goal.id, { ...answered, goalId: goal.id });
    await engine.reclarify(goal.id, 'test');
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const clarifyPrompt = runner.calls.filter((c) => c.label?.startsWith('clarify')).at(-1)!.prompt;
    expect(clarifyPrompt).toContain('# Decisions already made by the human');
    expect(clarifyPrompt).toContain('A: No, students only');

    // workers receive the decisions
    const again = getBrief(engine.store.db, goal.id)!.brief;
    engine.editBrief(goal.id, { ...again, questions: again.questions.map((x) => ({ ...x, answer: 'yes' })) });
    await engine.approveBrief(goal.id);
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('attempt')));
    expect(runner.calls.find((c) => c.label?.startsWith('attempt'))!.prompt).toContain('# Decisions from the human');
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 30_000);
});
