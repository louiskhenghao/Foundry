import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getBrief, getGoal, listTasks } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-clarify-'));
  repo = await makeRepo();
});
const engines: Engine[] = [];
/** every Engine a test makes is stopped (background ticks drained) before the dataDir is deleted */
const track = <T extends Engine>(e: T): T => {
  engines.push(e);
  return e;
};
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true }); // the progress folders of goals created here
});

/**
 * Runner that answers every session with a scripted structured output, chosen by call index.
 * The auto-goal nature pre-classification (label `classify nature …`) is answered separately
 * (default `code`) and does not consume an index, so scripts keep their call numbering.
 */
class StructuredRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  classifyAs: 'code' | 'docs' | 'research' | 'image' | 'video' = 'code';
  private mainCalls = 0;
  constructor(private answers: (spec: RunSpec, n: number) => unknown) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = spec.label?.startsWith('classify nature') ? { nature: this.classifyAs } : this.answers(spec, ++this.mainCalls);
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.5, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    // a scripted `{ __lost: true }` answer plays a resume that found no conversation (expired session)
    if ((structuredOutput as { __lost?: boolean } | null)?.__lost) Object.assign(result, { subtype: 'error', isError: true, numTurns: 0, errorMessage: 'No conversation found with session ID', structuredOutput: null, finalText: null });
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const areas = [
  { key: 'A1', name: 'Student portal', slug: 'student-portal', description: 'what students see' },
  { key: 'A2', name: 'Teacher portal', slug: 'teacher-portal', description: 'what teachers see' },
];
const task = (key: string, areaKey: string, title: string, deps: string[] = []): BriefOutput['tasks'][number] => ({ key, title, spec: `do ${title}`, kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey, dependsOnKeys: deps, parallelizable: true, relevantFiles: ['README.md'], milestone: null });
const check = (key: string, taskKey: string | null, areaKey: string | null = null): BriefOutput['checks'][number] => ({ key, name: key, tier: 'must', taskKey, areaKey, type: 'command', cmd: 'true', rubric: null });
const briefWith = (tasks: BriefOutput['tasks'], checks: BriefOutput['checks']): BriefOutput => ({ title: 'feat(portal): build portals', understanding: 'Two portals.', nature: 'code', areas, assumptions: ['a'], tasks, checks, costEstimateUsd: 4, timeEstimateMin: 30, questions: [], styleOptions: [], run: null });

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

describe('clarify coverage gate', () => {
  test('an Area without tasks triggers one repair turn in the same session; the repaired Brief is kept', async () => {
    const runner = new StructuredRunner((spec, n) => (n === 1 ? briefWith([task('T1', 'A1', 'add student home')], [check('C1', 'T1'), check('G1', null, 'A1')]) : briefWith([task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1'])], [check('C1', 'T1'), check('C2', 'T2'), check('G1', null, 'A1')])));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const main = runner.calls.filter((c) => !c.label?.startsWith('classify nature'));
    expect(runner.calls).toHaveLength(3); // classify + clarify + coverage repair
    expect(main).toHaveLength(2);
    expect(main[1]!.resumeSessionId).toBe('s2'); // resumes the clarify session (s1 was the classification)
    expect(main[1]!.prompt).toContain('"Teacher portal" (A2)');
    expect(main[0]!.prompt).toContain('every Area MUST have at least one task');
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    expect(brief.areas.map((a) => a.key)).toEqual(['A1', 'A2']);
    expect(brief.tasks.map((t) => [t.key, t.areaKey])).toEqual([['T1', 'A1'], ['T2', 'A2']]);
    expect(brief.checks.find((c) => c.key === 'G1')).toMatchObject({ taskKey: null, areaKey: 'A1' });
    expect(brief.questions.filter((q) => q.areaKey)).toHaveLength(0);
    const cost = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added').map((e) => (e.payload as { source: string }).source);
    expect(cost).toEqual(['clarify', 'clarify', 'clarify-coverage']); // classification is billed as clarify

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
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.filter((c) => !c.label?.startsWith('classify nature'))).toHaveLength(2);
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

describe('nature pre-classification', () => {
  test('an auto goal is classified before the prompt is built; the media sections replace the code ones', async () => {
    const runner = new StructuredRunner(() => ({ ...briefWith([{ ...task('T1', 'A1', 'render posters'), scenario: 'image' as const }], [check('C1', 'T1')]), nature: 'image' as const }));
    runner.classifyAs = 'image';
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: '生成三张产品海报', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    // the verdict was recorded before Clarify ran, and the goal carries it
    expect(getGoal(engine.store.db, goal.id)!.nature).toBe('image');
    const natureEvents = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.nature_set');
    expect(natureEvents.map((e) => (e.payload as { reason: string }).reason)).toEqual(['pre-clarify classification']);
    // the clarify prompt got the image sections, not the code ones (no tech-stack question, no repo-gate talk)
    const clarify = runner.calls.find((c) => c.label?.startsWith('clarify'))!;
    expect(clarify.prompt).toContain('# Nature: image');
    expect(clarify.prompt).not.toContain('Judge the nature first');
    expect(clarify.prompt).not.toContain('tech stack is the human');
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('styleOptions in the Clarifier output become Brief cards plus an engine-generated blocking style question', async () => {
    const styles = [
      { key: 'S1', name: 'Warm izakaya night', palette: ['#2b1d16', '#e8a13c'], fonts: ['Noto Serif JP'], keywords: ['lantern light', 'wood'], description: 'Cozy and warm.' },
      { key: 'S2', name: 'Minimal washi', palette: ['#f5f1e8', '#3a3a3a'], fonts: ['Zen Kaku Gothic'], keywords: ['negative space'], description: 'Clean and airy.' },
    ];
    const runner = new StructuredRunner(() => ({ ...briefWith([{ ...task('T1', 'A1', 'render posters'), scenario: 'image' as const }], [check('C1', 'T1')]), nature: 'image' as const, styleOptions: styles }));
    runner.classifyAs = 'image';
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'posters for the izakaya', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    expect(brief.styleOptions.map((s) => [s.key, s.samples, s.chosenSample])).toEqual([['S1', [], null], ['S2', [], null]]);
    const q = brief.questions.find((x) => x.kind === 'style')!;
    expect(q.blocking).toBe(true);
    expect(q.options).toEqual(['Warm izakaya night', 'Minimal washi']); // recommendation first
    // the clarify prompt asked for the style options
    expect(runner.calls.find((c) => c.label?.startsWith('clarify'))!.prompt).toContain('styleOptions');
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('style samples: regenerate appends files and events, never replacing earlier ones', async () => {
    const { startStyleSample, StyleSampleError } = await import('./style-sample.ts');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { goalWorkspacePath } = await import('./workspace.ts');
    const styles = [{ key: 'S1', name: 'Warm izakaya night', palette: ['#e8a13c'], fonts: [], keywords: ['warm'], description: 'Cozy.' }];
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('style sample')) {
        const m = spec.prompt.match(/artifacts\/samples\/[\w.-]+\.png/)!;
        mkdirSync(join(spec.cwd, 'artifacts', 'samples'), { recursive: true });
        writeFileSync(join(spec.cwd, m[0]), 'png-bytes');
        return {};
      }
      return { ...briefWith([{ ...task('T1', 'A1', 'render posters'), scenario: 'image' as const }], [check('C1', 'T1')]), nature: 'image' as const, styleOptions: styles };
    });
    runner.classifyAs = 'image';
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'posters', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    startStyleSample(engine, goal.id, 'S1');
    await waitFor(() => getBrief(engine.store.db, goal.id)!.brief.styleOptions[0]!.samples.length === 1);
    // regenerate: the second sample appends, the first survives on disk and in the Brief
    startStyleSample(engine, goal.id, 'S1');
    await waitFor(() => getBrief(engine.store.db, goal.id)!.brief.styleOptions[0]!.samples.length === 2);
    const opt = getBrief(engine.store.db, goal.id)!.brief.styleOptions[0]!;
    expect(opt.samples).toEqual(['artifacts/samples/S1-1.png', 'artifacts/samples/S1-2.png']);
    const ws = goalWorkspacePath(dataDir, goal);
    const { existsSync } = await import('node:fs');
    for (const f of opt.samples) expect(existsSync(join(ws, f))).toBe(true);
    // artifacts stay out of git even at Brief time
    expect((await Bun.$`git -C ${ws} status --porcelain`.text()).trim()).toBe('');
    expect(() => startStyleSample(engine, goal.id, 'NOPE')).toThrow(StyleSampleError);
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('a user-chosen nature is never classified nor overridden by the verdict', async () => {
    const runner = new StructuredRunner(() => ({ ...briefWith([task('T1', 'A1', 'write the guide')], [check('C1', 'T1')]), nature: 'code' as const }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'write the onboarding guide', repoPath: repo, nature: 'docs' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.some((c) => c.label?.startsWith('classify nature'))).toBe(false);
    expect(getGoal(engine.store.db, goal.id)!.nature).toBe('docs');
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
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const { goalId: _g, ...brief } = getBrief(engine.store.db, goal.id)!.brief;
    // the page adds an empty task (unsaved) and asks for a draft
    const draft = { ...brief, tasks: [...brief.tasks, { key: 'T2', title: 'add teacher home', spec: '', kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: [], parallelizable: true, relevantFiles: [], milestone: null }] };
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
    const engine = track(new Engine(cfg(), runner));
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

describe('clarify interview', () => {
  const q = (key: string, text: string, options: string[], blocking = true, dependsOn: string | null = null) => ({ key, text, options, reason: `found nothing about ${text}`, dependsOn, blocking });
  const fullBrief = () => briefWith([task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1'])], [check('C1', 'T1'), check('C2', 'T2')]);
  const main = (r: StructuredRunner) => r.calls.filter((c) => !c.label?.startsWith('classify nature'));
  const iv = (engine: Engine, id: string) => getGoal(engine.store.db, id)!.interview!;

  test('rounds of questions, each reshaped by the answers, then the Brief with the answers as Decisions', async () => {
    const runner = new StructuredRunner((_spec, n) =>
      n === 1
        ? { questions: [q('R1Q1', 'Which database?', ['Postgres', 'SQLite']), q('R1Q2', 'Accounts?', ['none', 'email'], false)], brief: null }
        : n === 2
          ? { questions: [q('R2Q1', 'Which ORM?', ['Prisma', 'Drizzle'], true, 'R1Q1')], brief: null }
          : { questions: [], brief: fullBrief() },
    );
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    expect(goal.interview).toMatchObject({ mode: 'auto', status: 'thinking', rounds: [] });
    await waitFor(() => iv(engine, goal.id).status === 'awaiting_answers');
    expect(main(runner)[0]!.prompt).toContain('# Interview before the Brief');
    expect(iv(engine, goal.id).rounds[0]!.questions.map((x) => x.key)).toEqual(['R1Q1', 'R1Q2']);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('clarifying');
    // blocking questions must be answered unless the human says enough
    expect(() => engine.answerInterview(goal.id, { R1Q2: 'none' })).toThrow(/blocking/);
    engine.answerInterview(goal.id, { R1Q1: 'Postgres' });
    await waitFor(() => iv(engine, goal.id).rounds.length === 2 && iv(engine, goal.id).status === 'awaiting_answers');
    const second = main(runner)[1]!;
    expect(second.resumeSessionId).toBe('s2'); // the clarify session (s1 was the nature classification)
    expect(second.prompt).toContain('# Round 1 answers');
    expect(second.prompt).toContain('A: Postgres');
    expect(second.prompt).toContain('(no answer');
    expect(iv(engine, goal.id).rounds[1]!.questions[0]).toMatchObject({ key: 'R2Q1', dependsOn: 'R1Q1' });
    engine.answerInterview(goal.id, { R2Q1: 'Prisma' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(iv(engine, goal.id).status).toBe('done');
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    const decided = brief.questions.filter((x) => x.applied && x.answer);
    expect(decided.map((x) => [x.text, x.answer])).toEqual([
      ['Which database?', 'Postgres'],
      ['Which ORM?', 'Prisma'],
    ]);
    expect(engine.store.listByGoal(goal.id).find((e) => e.type === 'interview.finished')?.payload).toMatchObject({ rounds: 2, reason: 'brief' });
    // a revision resumes the interview session instead of starting cold
    await engine.draftBrief(goal.id, { mode: 'revise', brief, taskKey: null, areaKey: null, notes: '' }).catch(() => null); // the scripted answer is not a revision; only the resume matters here
    const reviseCall = runner.calls.find((c) => c.label?.startsWith('draft revise'))!;
    expect(reviseCall.resumeSessionId).toBe('s3'); // the session of the latest round
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('"enough" writes the Brief with what there is; a lost session starts over with the interview so far', async () => {
    const runner = new StructuredRunner((_spec, n) => (n === 1 ? { questions: [q('R1Q1', 'Which database?', ['Postgres', 'SQLite'])], brief: null } : n === 2 ? { __lost: true } : { questions: [], brief: fullBrief() }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => iv(engine, goal.id).status === 'awaiting_answers');
    engine.answerInterview(goal.id, {}, true); // blocking left open, but the human asked for the Brief
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const calls = main(runner);
    expect(calls).toHaveLength(3);
    expect(calls[1]!.resumeSessionId).toBe('s2');
    expect(calls[1]!.prompt).toContain('stop asking and write the Brief now');
    expect(calls[2]!.resumeSessionId).toBeUndefined(); // fresh session after the lost resume
    expect(calls[2]!.prompt).toContain('# Interview so far');
    expect(calls[2]!.prompt).toContain('# Interview before the Brief');
    expect(engine.store.listByGoal(goal.id).find((e) => e.type === 'interview.finished')?.payload).toMatchObject({ rounds: 1, reason: 'human' });
    expect(getBrief(engine.store.db, goal.id)!.brief.questions.filter((x) => x.applied)).toHaveLength(0); // nothing was answered
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('after the round cap the Clarifier is told to write the Brief; mode never keeps the one-shot Clarify', async () => {
    const runner = new StructuredRunner((_spec, n) => (n <= 5 ? { questions: [q(`R${n}Q1`, `question ${n}`, ['a', 'b'])], brief: null } : { questions: [], brief: fullBrief() }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'always' });
    for (let round = 1; round <= 4; round++) {
      await waitFor(() => iv(engine, goal.id).rounds.length === round && iv(engine, goal.id).status === 'awaiting_answers');
      engine.answerInterview(goal.id, { [`R${round}Q1`]: 'a' });
    }
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const calls = main(runner);
    expect(calls).toHaveLength(6); // 4 rounds + a fifth answer that still asked + the "no more questions" turn
    expect(calls[4]!.prompt).toContain('the last one: write the Brief now');
    expect(calls[5]!.prompt).toContain('No more questions can be asked');
    expect(iv(engine, goal.id).rounds).toHaveLength(4);
    expect(engine.store.listByGoal(goal.id).find((e) => e.type === 'interview.finished')?.payload).toMatchObject({ rounds: 4, reason: 'cap' });
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);

    const plain = new StructuredRunner(() => fullBrief());
    const engine2 = track(new Engine(cfg(), plain));
    const g2 = await engine2.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'never' });
    expect(g2.interview).toBeNull();
    await waitFor(() => getGoal(engine2.store.db, g2.id)!.state === 'awaiting_brief_approval');
    expect(main(plain)[0]!.prompt).not.toContain('# Interview before the Brief');
    engine2.cancelGoal(g2.id);
    await Bun.sleep(150);
  }, 30_000);
});
