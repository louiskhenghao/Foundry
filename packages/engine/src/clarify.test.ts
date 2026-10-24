import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput, BriefSkeleton, PlanOutput } from '@foundry/core';
import { INTERVIEW_MAX_ROUNDS, getBrief, getGoal, listChecks, listTasks, noteQuestion, renderDecisions } from '@foundry/core';
import { FIGURE_CHECK_NAME } from './checks/figure.ts';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { fakeCadPlugin } from './skills/fake-home.test-helper.ts';
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
  classifyAs: 'code' | 'docs' | 'research' | 'image' | 'video' | 'figure' | 'cad' = 'code';
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
const briefWith = (tasks: BriefOutput['tasks'], checks: BriefOutput['checks']): BriefOutput => ({ title: 'feat(portal): build portals', understanding: 'Two portals.', nature: 'code', areas, assumptions: ['a'], tasks, checks, costEstimateUsd: 4, timeEstimateMin: 30, openQuestions: [], styleOptions: [], run: null, apps: null });

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

describe('clarify coverage gate', () => {
  test('a whole Brief from the Clarifier with an Area without tasks gets one repair turn in the same session; the repaired Brief is kept', async () => {
    const runner = new StructuredRunner((spec, n) => (n === 1 ? briefWith([task('T1', 'A1', 'add student home')], [check('C1', 'T1'), check('G1', null, 'A1')]) : briefWith([task('T1', 'A1', 'add student home'), { ...task('T2', 'A2', 'add teacher home', ['T1']), difficulty: 'complex' as const }], [check('C1', 'T1'), check('C2', 'T2'), check('G1', null, 'A1')])));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const main = runner.calls.filter((c) => !c.label?.startsWith('classify nature'));
    expect(runner.calls).toHaveLength(3); // classify + clarify + coverage repair
    expect(main).toHaveLength(2);
    expect(main[1]!.resumeSessionId).toBe('s2'); // resumes the clarify session (s1 was the classification)
    expect(main[1]!.prompt).toContain('"Teacher portal" (A2)');
    expect(main[0]!.prompt).toContain('a planner session splits the goal into tasks right after you');
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    expect(brief.areas.map((a) => a.key)).toEqual(['A1', 'A2']);
    expect(brief.tasks.map((t) => [t.key, t.areaKey])).toEqual([['T1', 'A1'], ['T2', 'A2']]);
    expect(brief.checks.find((c) => c.key === 'G1')).toMatchObject({ taskKey: null, areaKey: 'A1' });
    expect(brief.tasks.map((t) => t.difficulty)).toEqual(['standard', 'complex']); // the Clarifier's rating reaches the Brief
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
  test('cad is a verdict only where text-to-cad is installed; without it the goal is code work, with it the Clarifier gets the cad rules', async () => {
    const { mkdirSync: mkdir, writeFileSync: write } = require('node:fs') as typeof import('node:fs');
    const cadBrief = () => ({ ...briefWith([{ ...task('T1', 'A1', 'model the bracket'), scenario: 'cad' as const }], [check('C1', 'T1')]), nature: 'cad' as const });
    // not installed: the classifier is not even offered cad, and a cad answer is read as code
    const bare = new StructuredRunner(() => cadBrief());
    bare.classifyAs = 'cad';
    const engine = track(new Engine(cfg(), bare));
    const g1 = await engine.createGoal({ prompt: 'a wall bracket for a 40 mm pipe, FDM printed', repoPath: repo });
    await waitFor(() => bare.calls.some((c) => c.label?.startsWith('clarify')), 20_000);
    expect(bare.calls.find((c) => c.label?.startsWith('classify nature'))!.prompt).not.toContain('cad =');
    expect(getGoal(engine.store.db, g1.id)!.nature).toBe('code');
    engine.cancelGoal(g1.id);
    // installed (a cad skill on disk counts): the verdict stands and the Clarifier is told the cad rules
    mkdir(join(dataDir, 'claude-home', 'skills', 'cad'), { recursive: true });
    write(join(dataDir, 'claude-home', 'skills', 'cad', 'SKILL.md'), '---\nname: cad\ndescription: cad\n---\nmodel');
    const runner = new StructuredRunner(() => cadBrief());
    runner.classifyAs = 'cad';
    const engine2 = track(new Engine(cfg(), runner));
    const g2 = await engine2.createGoal({ prompt: 'a wall bracket for a 40 mm pipe, FDM printed', repoPath: repo });
    await waitFor(() => getGoal(engine2.store.db, g2.id)!.state === 'awaiting_brief_approval', 20_000);
    expect(getGoal(engine2.store.db, g2.id)!.nature).toBe('cad');
    expect(runner.calls.find((c) => c.label?.startsWith('classify nature'))!.prompt).toContain('cad =');
    const clarify = runner.calls.find((c) => c.label?.startsWith('clarify'))!;
    expect(clarify.prompt).toContain('# Nature: cad');
    expect(clarify.prompt).toContain('BLOCKING');
    // checks measure the exports under artifacts/, never the cad skill's own folders or its plugin path
    expect(clarify.prompt).toContain("on the exports under `artifacts/` (not the cad skill's `STEP/` and `STL/` folders)");
    expect(clarify.prompt).toContain("no check reaches into the coding agent's plugin folder");
    expect(clarify.prompt).not.toContain('# Nature: image');
    engine2.cancelGoal(g2.id);
    await Bun.sleep(150);
  }, 30_000);

  test('a cad goal waits in clarifying until text-to-cad is in, says so once, and then clarifies by itself', async () => {
    const brief = () => ({ ...briefWith([{ ...task('T1', 'A1', 'model the bracket'), scenario: 'cad' as const }], [check('C1', 'T1')]), nature: 'cad' as const });
    const runner = new StructuredRunner(() => brief());
    const engine = track(new Engine(cfg(), runner));
    const g = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, nature: 'cad' });
    const notes = () => engine.store.listByGoal(g.id).filter((e) => e.type === 'engine.note' && String((e.payload as { message: string }).message).startsWith('text-to-cad is not installed'));
    await waitFor(() => notes().length > 0);
    engine.tick(g.id);
    await Bun.sleep(100);
    engine.tick(g.id);
    await Bun.sleep(100);
    expect(notes()).toHaveLength(1);
    expect(getGoal(engine.store.db, g.id)!.state).toBe('clarifying');
    expect(runner.calls.some((c) => c.label?.startsWith('clarify') || c.label?.startsWith('classify'))).toBe(false);
    expect(await engine.cadStatus('claude')).toMatchObject({ installed: false });
    // a goal that skips Clarify is refused up front instead
    await expect(engine.createGoal({ prompt: 'a bracket', repoPath: repo, nature: 'cad', autoBrief: { mustChecks: ['true'] } })).rejects.toThrow(/text-to-cad is not installed/);
    // the plugin turns up (installed by hand): the next answer about it lets the goal go on
    fakeCadPlugin(join(dataDir, 'claude-home'));
    engine.pluginInstalled('claude');
    expect(await engine.cadStatus('claude')).toMatchObject({ installed: true });
    await waitFor(() => getGoal(engine.store.db, g.id)!.state === 'awaiting_brief_approval', 20_000);
    expect(getGoal(engine.store.db, g.id)!.nature).toBe('cad');
    engine.cancelGoal(g.id);
    await Bun.sleep(150);
  }, 30_000);

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
    const full = briefWith([{ ...task('T1', 'A1', 'add student home'), milestone: 'the student home page' }, task('T2', 'A2', 'add teacher home', ['T1']), task('T3', 'A2', 'add grading', ['T2'])], [check('C1', 'T1'), check('C2', 'T2'), check('G1', null)]);
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('clarify')) return { ...full, openQuestions: [{ text: 'Teachers too?', blocking: true, areaKey: 'A2' }] };
      if (spec.label?.startsWith('draft revise')) {
        const { openQuestions: _q, ...rest } = full;
        return { ...rest, understanding: 'Students only.', areas: [full.areas[0]], tasks: [(({ milestone: _m, ...t }) => t)(task('T1', 'A1', 'add student home')), task('T4', 'A1', 'add student grades', ['T1'])], checks: [check('C1', 'T1', null), check('C9', 'T4')], changeSummary: 'Dropped the teacher tasks because the human said students only.', newQuestions: [] };
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
    // a kept task's milestone survives a reply that leaves it out
    expect(p.revision!.revised.tasks.find((t) => t.key === 'T1')?.milestone).toBe('the student home page');
    expect(p.revision!.revised.questions.find((x) => x.id === q.id)?.answer).toBe('No, students only');
    // the rejected assumption survives the revision even though the model dropped it
    expect(p.revision!.revised.assumptions.some((a) => !a.accepted)).toBe(true);
    const prompt = runner.calls.at(-1)!.prompt;
    expect(prompt).toContain('## Decisions from the human');
    expect(prompt).toContain('A: No, students only');
    expect(prompt).toContain('Rejected assumption');
    expect(engine.store.listByGoal(goal.id, 5000).some((e) => e.type === 'goal.cost_added' && (e.payload as { source: string }).source === 'revise')).toBe(true);

    // re-run Clarify keeps the decisions, a note written on the Brief page among them
    engine.editBrief(goal.id, { ...answered, goalId: goal.id, questions: [...answered.questions, noteQuestion('n1', 'Use the existing design tokens, no new colours')] });
    await engine.reclarify(goal.id, 'test');
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const clarifyPrompt = runner.calls.filter((c) => c.label?.startsWith('clarify')).at(-1)!.prompt;
    expect(clarifyPrompt).toContain('# Decisions already made by the human');
    expect(clarifyPrompt).toContain('A: No, students only');
    expect(clarifyPrompt).toContain('Note from the human (unasked): Use the existing design tokens, no new colours');

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

describe('revise rounds', () => {
  const q = (key: string, text: string, options: string[], blocking = false) => ({ key, text, options, reason: `the decision leaves ${text} open`, dependsOn: null, blocking });
  const full = () => briefWith([task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1'])], [check('C1', 'T1'), check('C2', 'T2')]);
  const revision = (understanding: string) => {
    const { openQuestions: _q, ...rest } = full();
    return { ...rest, understanding, changeSummary: 'Followed the decisions.', newQuestions: [] };
  };
  const ready = async (engine: Engine, goalId: string) => waitFor(() => getGoal(engine.store.db, goalId)!.state === 'awaiting_brief_approval');

  test('a Revise may ask back: the round waits on the goal, the answers and note resume the session, the proposal carries them as Decisions', async () => {
    let reviseTurns = 0;
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('clarify')) return full();
      if (spec.label?.startsWith('draft revise')) return ++reviseTurns === 1 ? { questions: [q('R1Q1', 'Drop the teacher portal entirely, or keep a read-only one?', ['Drop it', 'Keep read-only'])], revision: null } : { questions: [], revision: revision('Students only, teachers read-only.') };
      return null;
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'portals', repoPath: repo });
    await ready(engine, goal.id);
    const { goalId: _g, ...brief } = getBrief(engine.store.db, goal.id)!.brief;
    const answered = { ...brief, questions: [...brief.questions, noteQuestion('n1', 'Students first; teachers can wait')] };

    const first = await engine.draftBrief(goal.id, { mode: 'revise', brief: answered, taskKey: null, areaKey: null, notes: '' });
    expect(first.revision).toBeUndefined();
    expect(first.round).toMatchObject({ round: 1, questions: [{ key: 'R1Q1', options: ['Drop it', 'Keep read-only'] }] });
    const g1 = getGoal(engine.store.db, goal.id)!;
    expect(g1.revise).toMatchObject({ status: 'awaiting_answers', rounds: [{ round: 1, answers: null }] });
    expect(g1.state).toBe('awaiting_brief_approval'); // the Brief can still be approved meanwhile
    expect(runner.calls.at(-1)!.prompt).toContain('You may ask the human'); // the Revise prompt allows the question round

    // the answers resume the session that asked
    const asked = runner.calls.length;
    const second = await engine.answerRevise(goal.id, { brief: answered, answers: { R1Q1: 'Keep read-only' }, finish: false, note: 'and no grading for teachers' });
    const resumed = runner.calls.at(-1)!;
    expect(resumed.resumeSessionId).toBe(`s${asked}`); // the round's turn was call number `asked`, and its session id is s<that>
    expect(resumed.prompt).toContain('# Round 1 answers');
    expect(resumed.prompt).toContain('A: Keep read-only');
    expect(resumed.prompt).toContain('and no grading for teachers');
    expect(second.round).toBeUndefined();
    expect(second.revision?.revised.understanding).toBe('Students only, teachers read-only.');
    // the round's answer and note come back on the revised Brief as applied Decisions; the page's own note stays pending until accepted
    const decided = second.revision!.revised.questions.filter((x) => x.applied);
    expect(decided.map((x) => [x.kind, x.text, x.answer])).toEqual([
      ['text', 'Drop the teacher portal entirely, or keep a read-only one?', 'Keep read-only'],
      ['note', 'and no grading for teachers', 'and no grading for teachers'],
    ]);
    expect(second.revision!.revised.questions.find((x) => x.id === 'n1')).toMatchObject({ kind: 'note', applied: false });
    expect(getGoal(engine.store.db, goal.id)!.revise?.status).toBe('done');
    expect(engine.store.listByGoal(goal.id).filter((e) => e.type.startsWith('revise.')).map((e) => e.type)).toEqual(['revise.round_asked', 'revise.round_answered', 'revise.finished']);
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 30_000);

  test('after two rounds the Revise is told to propose; "enough" does the same; cancelling or approving abandons an open round', async () => {
    let n = 0;
    const runner = new StructuredRunner((spec) => {
      if (spec.label?.startsWith('clarify')) return full();
      if (spec.label?.startsWith('draft revise')) return ++n <= 3 ? { questions: [q(`R${n}Q1`, `question ${n}`, ['a', 'b'])], revision: null } : { questions: [], revision: revision(`after ${n} turns`) };
      return null;
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'portals', repoPath: repo });
    await ready(engine, goal.id);
    const { goalId: _g, ...brief } = getBrief(engine.store.db, goal.id)!.brief;
    expect((await engine.draftBrief(goal.id, { mode: 'revise', brief, taskKey: null, areaKey: null, notes: '' })).round?.round).toBe(1);
    expect((await engine.answerRevise(goal.id, { brief, answers: { R1Q1: 'a' }, finish: false, note: null })).round?.round).toBe(2);
    const third = await engine.answerRevise(goal.id, { brief, answers: { R2Q1: 'b' }, finish: false, note: null });
    expect(runner.calls.at(-2)!.prompt).toContain('the last one you may ask'); // the answers to round 2 say so
    expect(runner.calls.at(-1)!.prompt).toContain('No more questions'); // it asked anyway: one forcing turn, no third round
    expect(third.round).toBeUndefined();
    expect(third.revision?.revised.understanding).toBe('after 4 turns');
    expect(engine.store.listByGoal(goal.id).filter((e) => e.type === 'revise.finished').at(-1)?.payload).toMatchObject({ rounds: 2, reason: 'proposal' });

    // "enough" with a round open: the Revise proposes with its recommendations
    n = 0;
    expect((await engine.draftBrief(goal.id, { mode: 'revise', brief, taskKey: null, areaKey: null, notes: '' })).round?.round).toBe(1);
    n = 5; // the next turn proposes
    const enough = await engine.answerRevise(goal.id, { brief, answers: {}, finish: true, note: null });
    expect(runner.calls.at(-1)!.prompt).toContain('stop asking');
    expect(enough.revision).toBeDefined();

    // cancelling an open round, and approving the Brief over one, end it as abandoned
    n = 0;
    await engine.draftBrief(goal.id, { mode: 'revise', brief, taskKey: null, areaKey: null, notes: '' });
    engine.cancelRevise(goal.id);
    expect(getGoal(engine.store.db, goal.id)!.revise?.status).toBe('done');
    expect(engine.store.listByGoal(goal.id).filter((e) => e.type === 'revise.finished').at(-1)?.payload).toMatchObject({ reason: 'abandoned' });
    await expect(engine.answerRevise(goal.id, { brief, answers: { R1Q1: 'a' }, finish: false, note: null })).rejects.toThrow(/no Revise round/);
    n = 0;
    await engine.draftBrief(goal.id, { mode: 'revise', brief, taskKey: null, areaKey: null, notes: '' });
    await engine.approveBrief(goal.id, { ...brief, goalId: goal.id, questions: brief.questions.map((x) => ({ ...x, answer: x.answer ?? 'ok' })) });
    expect(engine.store.listByGoal(goal.id).filter((e) => e.type === 'revise.finished').at(-1)?.payload).toMatchObject({ reason: 'abandoned' });
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 40_000);
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
    // a note: what the questions missed, sent with the answers
    engine.answerInterview(goal.id, { R1Q1: 'Postgres' }, false, '  Keep the old login page too; the admin role is out of scope.  ');
    await waitFor(() => iv(engine, goal.id).rounds.length === 2 && iv(engine, goal.id).status === 'awaiting_answers');
    expect(iv(engine, goal.id).rounds[0]!.note).toBe('Keep the old login page too; the admin role is out of scope.');
    const second = main(runner)[1]!;
    expect(second.resumeSessionId).toBe('s2'); // the clarify session (s1 was the nature classification)
    expect(second.prompt).toContain('# Round 1 answers');
    expect(second.prompt).toContain('A: Postgres');
    expect(second.prompt).toContain('(no answer');
    expect(second.prompt).toContain('# Also from the human (unasked)\nKeep the old login page too; the admin role is out of scope.');
    expect(iv(engine, goal.id).rounds[1]!.questions[0]).toMatchObject({ key: 'R2Q1', dependsOn: 'R1Q1' });
    engine.answerInterview(goal.id, { R2Q1: 'Prisma' }, false, '   ');
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(iv(engine, goal.id).status).toBe('done');
    expect(iv(engine, goal.id).rounds[1]!.note).toBeNull(); // blank notes are not kept
    const brief = getBrief(engine.store.db, goal.id)!.brief;
    const decided = brief.questions.filter((x) => x.applied && x.answer);
    expect(decided.map((x) => [x.kind, x.text, x.answer])).toEqual([
      ['text', 'Which database?', 'Postgres'],
      ['text', 'Which ORM?', 'Prisma'],
      ['note', 'Keep the old login page too; the admin role is out of scope.', 'Keep the old login page too; the admin role is out of scope.'],
    ]);
    // the note reaches every session as a Decision, like an answer
    expect(renderDecisions(brief)).toContain('Note from the human (unasked): Keep the old login page too');
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
    engine.answerInterview(goal.id, {}, true, 'SQLite is fine; just keep it simple'); // blocking left open, but the human asked for the Brief
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const calls = main(runner);
    expect(calls).toHaveLength(3);
    expect(calls[1]!.resumeSessionId).toBe('s2');
    expect(calls[1]!.prompt).toContain('stop asking and write the Brief now');
    expect(calls[2]!.resumeSessionId).toBeUndefined(); // fresh session after the lost resume
    expect(calls[2]!.prompt).toContain('# Interview so far');
    expect(calls[2]!.prompt).toContain('Note from the human: SQLite is fine; just keep it simple'); // the note survives the lost session with the answers
    expect(calls[2]!.prompt).toContain('# Interview before the Brief');
    expect(engine.store.listByGoal(goal.id).find((e) => e.type === 'interview.finished')?.payload).toMatchObject({ rounds: 1, reason: 'human' });
    expect(getBrief(engine.store.db, goal.id)!.brief.questions.filter((x) => x.applied).map((x) => x.kind)).toEqual(['note']); // nothing was answered; the note is a Decision
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('after the round cap the Clarifier is told to write the Brief; mode never keeps the one-shot Clarify', async () => {
    const cap = INTERVIEW_MAX_ROUNDS;
    const runner = new StructuredRunner((_spec, n) => (n <= cap + 1 ? { questions: [q(`R${n}Q1`, `question ${n}`, ['a', 'b'])], brief: null } : { questions: [], brief: fullBrief() }));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interviewDepth: 5 });
    for (let round = 1; round <= cap; round++) {
      await waitFor(() => iv(engine, goal.id).rounds.length === round && iv(engine, goal.id).status === 'awaiting_answers');
      engine.answerInterview(goal.id, { [`R${round}Q1`]: 'a' });
    }
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval', 30_000);
    const calls = main(runner);
    expect(calls[0]!.prompt).toContain('Depth 5 of 5 (to the bottom)');
    expect(calls).toHaveLength(cap + 2); // every round + an answer that still asked + the "no more questions" turn
    expect(calls[cap]!.prompt).toContain('the last one: write the Brief now');
    expect(calls[cap + 1]!.prompt).toContain('No more questions can be asked');
    expect(iv(engine, goal.id).rounds).toHaveLength(cap);
    expect(engine.store.listByGoal(goal.id).find((e) => e.type === 'interview.finished')?.payload).toMatchObject({ rounds: cap, reason: 'cap' });
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);

    const plain = new StructuredRunner(() => fullBrief());
    const engine2 = track(new Engine(cfg(), plain));
    const g2 = await engine2.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'never' });
    expect(g2.interview).toBeNull();
    await waitFor(() => getGoal(engine2.store.db, g2.id)!.state === 'awaiting_brief_approval');
    expect(main(plain)[0]!.prompt).not.toContain('# Interview before the Brief');
    // depth 0 is no interview; the older modes stand for depths 3 and 4
    expect((await engine2.createGoal({ prompt: 'x', repoPath: repo, interviewDepth: 0 })).interview).toBeNull();
    expect((await engine2.createGoal({ prompt: 'x', repoPath: repo, interview: 'always' })).interview).toMatchObject({ mode: 'always', depth: 4 });
    expect((await engine2.createGoal({ prompt: 'x', repoPath: repo })).interview).toMatchObject({ mode: 'auto', depth: 3 });
    engine2.cancelGoal(g2.id);
    await Bun.sleep(150);
  }, 60_000);
});

describe('skeleton first', () => {
  const skeleton = (): BriefSkeleton => ({ title: 'feat(portal): build portals', understanding: 'Two portals.', nature: 'code', areas, assumptions: ['a'], openQuestions: [], styleOptions: [], run: null, apps: null, goalChecks: [{ key: 'G1', name: 'G1', tier: 'must', areaKey: null, type: 'command', cmd: 'true', rubric: null }], planningNotes: 'notes' });
  const plan = (): PlanOutput => ({ tasks: [task('T1', 'A1', 'add student home'), task('T2', 'A2', 'add teacher home', ['T1'])], checks: [{ ...check('C1', 'T1'), taskKey: 'T1' }, { ...check('G1', 'T2'), taskKey: 'T2' }], costEstimateUsd: 4, timeEstimateMin: 30 });
  const ok = (): RunResult => ({ sessionId: 'held', subtype: 'success', isError: false, costUsd: 0, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: null, structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} });
  const idle = async function* (): AsyncGenerator<RunnerEvent> {};

  /** answers like StructuredRunner, but a planner session waits until the test opens the gate */
  class GatedRunner extends StructuredRunner {
    open!: () => void;
    private gate = new Promise<void>((r) => (this.open = r));
    override async run(spec: RunSpec): Promise<RunHandle> {
      if (spec.label?.startsWith('planner')) await this.gate;
      return super.run(spec);
    }
  }

  test('the skeleton is stored and shown while the planner works; the edits made meanwhile survive the plan', async () => {
    const runner = new GatedRunner((spec) => (spec.label?.startsWith('planner') ? plan() : skeleton()));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'never' });
    // no Brief yet: nothing to edit
    expect(() => engine.editBrief(goal.id, { ...briefWith([], []), goalId: goal.id } as never)).toThrow(/cannot be edited/);
    await waitFor(() => !!getBrief(engine.store.db, goal.id)?.skeleton);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('clarifying');
    const stored = getBrief(engine.store.db, goal.id)!;
    expect(stored.brief.tasks).toEqual([]);
    expect(stored.brief.areas.map((a) => a.key)).toEqual(['A1', 'A2']);
    expect(stored.brief.checks.map((c) => [c.key, c.taskKey])).toEqual([['G1', null]]);
    expect(stored.brief.assumptions.map((a) => a.text)).toEqual(['a']);
    const types = engine.store.listByGoal(goal.id).map((e) => e.type);
    expect(types).toContain('brief.skeleton_proposed');
    expect(types).not.toContain('brief.proposed');
    // edits while the planner runs: the understanding, a dropped Area, a new Area, an unaccepted assumption
    const edited = { ...stored.brief, understanding: 'Two portals, students first.', areas: [stored.brief.areas[0]!, { key: 'A3', name: 'Admin', slug: 'admin', description: '' }], assumptions: stored.brief.assumptions.map((a) => ({ ...a, accepted: false })) };
    engine.editBrief(goal.id, edited);
    expect(getBrief(engine.store.db, goal.id)).toMatchObject({ skeleton: true, brief: { understanding: 'Two portals, students first.' } });
    runner.open();
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const planned = getBrief(engine.store.db, goal.id)!;
    expect(planned.skeleton).toBe(false);
    expect(planned.brief.understanding).toBe('Two portals, students first.');
    expect(planned.brief.assumptions.map((a) => a.accepted)).toEqual([false]);
    expect(planned.brief.areas.map((a) => a.key)).toEqual(['A1', 'A3']);
    // the plan filled in: the task of the dropped Area went with its check; the kept goal-level check keeps its key
    expect(planned.brief.tasks.map((t) => [t.key, t.areaKey])).toEqual([['T1', 'A1']]);
    expect(planned.brief.checks.map((c) => [c.key, c.taskKey])).toEqual([['G1', null], ['C1', 'T1']]);
    expect(planned.brief.costEstimateUsd).toBe(4);
    expect(planned.brief.timeEstimateMin).toBe(30);
    // the Area added meanwhile has no tasks: the question says so
    expect(planned.brief.questions.some((q) => q.areaKey === 'A3' && /no tasks yet/.test(q.text))).toBe(true);
    expect(getGoal(engine.store.db, goal.id)!.clarifyStage).toBeNull();
    // a save made while the page still showed the skeleton, landing after the plan: the tasks stay
    engine.editBrief(goal.id, { ...planned.brief, tasks: [], checks: planned.brief.checks.filter((c) => c.taskKey === null), understanding: 'again' }, { skeleton: true });
    const after = getBrief(engine.store.db, goal.id)!.brief;
    expect(after.understanding).toBe('again');
    expect(after.tasks.map((t) => t.key)).toEqual(['T1']);
    expect(after.checks.map((c) => c.key)).toEqual(['G1', 'C1']);
    // the classifier, the Clarifier and the planner all ran in the lane a person waits for
    expect(runner.calls.every((c) => c.lane === 'interactive')).toBe(true);
  }, 20_000);

  test('cancelling the goal kills the Clarify session; what the killed session returns is not written', async () => {
    const killed: string[] = [];
    class HangingRunner extends StructuredRunner {
      override async run(spec: RunSpec): Promise<RunHandle> {
        if (!spec.label?.startsWith('clarify')) return super.run(spec);
        this.calls.push(spec);
        let end!: (r: RunResult) => void;
        const result = new Promise<RunResult>((r) => (end = r));
        return {
          pid: null,
          events: idle(),
          kill: (reason: string) => {
            killed.push(reason);
            end({ ...ok(), subtype: 'killed_manual', isError: true, numTurns: 0 });
          },
          result,
        };
      }
    }
    const runner = new HangingRunner(() => skeleton());
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'never' });
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('clarify')));
    engine.cancelGoal(goal.id);
    expect(killed).toEqual(['killed_manual']);
    await waitFor(() => !engine.clarifying.has(goal.id));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('cancelled');
    expect(getBrief(engine.store.db, goal.id)).toBeNull();
    expect(engine.store.listByGoal(goal.id).map((e) => e.type)).not.toContain('brief.proposed');
  });

  test('every slot taken, the one beyond the limit included: the goal says it waits, then Clarify runs in the interactive lane', async () => {
    const ends: (() => void)[] = [];
    class HoldingRunner extends StructuredRunner {
      override async run(spec: RunSpec): Promise<RunHandle> {
        if (spec.label !== 'hold') return super.run(spec);
        const result = new Promise<RunResult>((r) => ends.push(() => r(ok())));
        return { pid: null, events: idle(), kill() {}, result };
      }
    }
    const runner = new HoldingRunner((spec) => (spec.label?.startsWith('planner') ? plan() : skeleton()));
    const engine = track(new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, maxConcurrent: 1 }), runner));
    const held = [await engine.runner.run({ prompt: 'x', cwd: repo, label: 'hold', meta: { provider: 'claude' } }), await engine.runner.run({ prompt: 'x', cwd: repo, label: 'hold', lane: 'interactive', meta: { provider: 'claude' } })];
    expect(engine.runner.wouldQueue?.('interactive')).toBe(true);
    const goal = await engine.createGoal({ prompt: 'student and teacher portals', repoPath: repo, interview: 'never' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.clarifyStage?.stage === 'queued');
    expect(runner.calls.filter((c) => c.label !== 'hold')).toHaveLength(0);
    // a work session ends: Clarify gets the slot beyond the limit
    ends.shift()!();
    await held[0]!.result;
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval', 20_000);
    const stages = engine.store.listByGoal(goal.id).filter((e) => e.type === 'clarify.stage').map((e) => (e.payload as { stage: string }).stage);
    expect(stages[0]).toBe('queued');
    expect(stages).toContain('clarifying');
    expect(stages.at(-1)).toBe('planning');
    expect(runner.calls.filter((c) => c.label !== 'hold').every((c) => c.lane === 'interactive')).toBe(true);
    ends.shift()!();
    await held[1]!.result;
  }, 30_000);
});

describe('mergePlan', () => {
  test('a repeated task or check key becomes its own; a dependency on nothing or on itself is dropped', async () => {
    const { mergePlan } = await import('./clarify.ts');
    const { tasks: _t, checks: _c, costEstimateUsd: _e, timeEstimateMin: _m, ...base } = briefWith([], []);
    const skeleton = { ...base, goalChecks: [(({ taskKey: _k, ...c }) => c)(check('C1', null))], planningNotes: 'notes' };
    const merged = mergePlan(skeleton, {
      tasks: [task('T1', 'A1', 'add home'), task('T1', 'A1', 'add grades', ['T1', 'T1', 'T9']), task('T2', 'A2', 'add teacher home', ['T2', 'T1'])],
      checks: [check('C1', 'T1'), check('C1', 'T2'), check('C5', 'T7')].map((c) => ({ ...c, taskKey: c.taskKey! })),
      costEstimateUsd: 3,
      timeEstimateMin: 20,
    });
    expect(merged.tasks.map((t) => [t.key, t.dependsOnKeys])).toEqual([['T1', []], ['T1-2', ['T1']], ['T2', ['T1']]]);
    // a check of a task that does not exist goes; the goal-level check takes the next free key
    expect(merged.checks.map((c) => [c.key, c.taskKey])).toEqual([['C1', 'T1'], ['C1-2', 'T2'], ['C1-3', null]]);
  });
});

test('a style the interview already settled starts answered on the Brief; without one the question waits', async () => {
  const { toBrief } = await import('./clarify.ts');
  const goal = { id: 'g_style', follows: null } as never;
  const styles = [
    { key: 'S1', name: 'Warm kopitiam', palette: ['#F6EDDC'], fonts: ['Fraunces'], keywords: ['warm'], description: 'Cosy.', chosen: true },
    { key: 'S2', name: 'Minimal café', palette: ['#FFFFFF'], fonts: ['Inter'], keywords: ['clean'], description: 'Airy.' },
  ];
  const style = (out: BriefOutput) => toBrief(goal, out, []).questions.find((q) => q.kind === 'style')!;
  expect(style({ ...briefWith([task('T1', 'A1', 'build page')], []), styleOptions: styles })).toMatchObject({ answer: 'Warm kopitiam', applied: true, options: ['Warm kopitiam', 'Minimal café'] });
  expect(style({ ...briefWith([task('T1', 'A1', 'build page')], []), styleOptions: styles.map(({ chosen: _c, ...s }) => s) })).toMatchObject({ answer: null, applied: false });
});

describe('figure goals (ADR-0076)', () => {
  const figureBrief = (figurePack?: 'colorfigures' | 'iso-glow'): BriefOutput => ({ ...briefWith([{ ...task('T1', 'A1', 'draw the kettle'), scenario: 'figure' as const, delivers: ['artifacts/kettle.html'] }], [check('C1', 'T1')]), nature: 'figure' as const, ...(figurePack ? { figurePack } : {}) });
  const withBeta = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, betaFigure: true, log: () => {} });

  test('with the beta on, an auto goal classified as a figure gets the figure sections, and its figure task lands with the render check', async () => {
    const runner = new StructuredRunner(() => figureBrief());
    runner.classifyAs = 'figure';
    const engine = track(new Engine(withBeta(), runner));
    const goal = await engine.createGoal({ prompt: 'a kettle that boils and clicks off, as a colorfigure', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.nature).toBe('figure');
    const clarify = runner.calls.find((c) => c.label?.startsWith('clarify'))!;
    expect(clarify.prompt).toContain('# Nature: figure');
    // no figure skill is installed in this fake home: the Clarifier is told, and asked not to pick a style
    expect(clarify.prompt).toContain('No figure skill is installed');
    expect(clarify.prompt).not.toContain('no image-generation backend');
    await engine.approveBrief(goal.id);
    const t = listTasks(engine.store.db, goal.id).find((x) => x.title === 'draw the kettle')!;
    expect(t.scenario).toBe('figure');
    expect(t.tdd).toBe('off');
    const checks = listChecks(engine.store.db, goal.id).filter((c) => c.taskId === t.id);
    expect(checks.map((c) => [c.name, c.spec.type, c.tier])).toEqual(expect.arrayContaining([['Delivers artifacts/kettle.html', 'command', 'must'], [FIGURE_CHECK_NAME, 'figure', 'must']]));
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test("the Clarifier's style verdict sets the goal's Figure pack when the person chose none and that style is installed", async () => {
    mkdirSync(join(dataDir, 'claude-home', 'skills', 'iso-glow'), { recursive: true });
    writeFileSync(join(dataDir, 'claude-home', 'skills', 'iso-glow', 'SKILL.md'), '---\nname: iso-glow\ndescription: glow\n---\n');
    const runner = new StructuredRunner(() => figureBrief('iso-glow'));
    const engine = track(new Engine(withBeta(), runner));
    const goal = await engine.createGoal({ prompt: 'a dark glowing skyline', repoPath: repo, nature: 'figure' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    // a goal made as a figure is a media goal from the start: fast, and in the plain-language view
    expect(getGoal(engine.store.db, goal.id)!.workflow.pace).toBe('fast');
    expect(getGoal(engine.store.db, goal.id)!.mode).toBe('simple');
    const clarify = runner.calls.find((c) => c.label?.startsWith('clarify'))!;
    // Settings' default (Colorfigures) is not installed here, so the installed style is the one in use
    expect(clarify.prompt).toContain('The figure skill in use is iso-glow');
    expect(getGoal(engine.store.db, goal.id)!.figurePack).toBe('iso-glow');
    const set = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.figure_pack_set');
    expect(set.map((e) => (e.payload as { figurePack: string }).figurePack)).toEqual(['iso-glow']);
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);

  test('with the beta off, a figure verdict is image work and a figure goal cannot be made', async () => {
    const runner = new StructuredRunner(() => ({ ...briefWith([{ ...task('T1', 'A1', 'render posters'), scenario: 'image' as const }], [check('C1', 'T1')]), nature: 'image' as const }));
    runner.classifyAs = 'figure';
    const engine = track(new Engine(cfg(), runner));
    await expect(engine.createGoal({ prompt: 'a kettle', repoPath: repo, nature: 'figure' })).rejects.toThrow(/beta/);
    const goal = await engine.createGoal({ prompt: 'a kettle as a figure', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(getGoal(engine.store.db, goal.id)!.nature).toBe('image');
    expect(runner.calls.find((c) => c.label?.startsWith('clarify'))!.prompt).toContain('# Nature: image');
    engine.cancelGoal(goal.id);
    await Bun.sleep(150);
  }, 20_000);
});
