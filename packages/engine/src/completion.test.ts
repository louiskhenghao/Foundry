import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, type Brief } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { inferCompletion, runGraphRefresh } from './completion.ts';
import { defaultConfig } from './config.ts';
import { runDocsGeneration } from './docs-generate.ts';
import { Engine } from './engine.ts';
import { goalWorkspacePath } from './workspace.ts';

class FakeRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private behave: (spec: RunSpec, n: number) => void | Promise<void>) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    await this.behave(spec, this.calls.length);
    const result: RunResult = { sessionId: `fake-${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: 'done', structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

/** a stand-in for `npx autoskills`: installs one skill */
const fakeNpx = async (_argv: string[], cwd: string, onLine: (l: string) => void) => {
  mkdirSync(join(cwd, '.claude', 'skills', 'react'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'skills', 'react', 'SKILL.md'), '---\nname: react\n---\nrules');
  onLine('installed react');
  return { code: 0, tail: 'installed react' };
};

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-completion-repo-'));
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  await Bun.$`git -C ${dir} init -q -b main && git -C ${dir} -c user.name=t -c user.email=t@t add -A && git -C ${dir} -c user.name=t -c user.email=t@t commit -q -m init`.quiet();
  return dir;
}

async function waitFor(pred: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await Bun.sleep(25);
  }
}

const ROOT = resolve(import.meta.dir, '../..', '..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-completion-data-'));
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
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
const terminal = (s: string) => ['done', 'over_delivered', 'failed', 'cancelled'].includes(s);

const briefBase: Omit<Brief, 'tasks'> = { goalId: 'g', title: '', understanding: 'u', areas: [], assumptions: [], checks: [], costEstimateUsd: 1, timeEstimateMin: 5, questions: [], styleOptions: [] };
const task = (scenario: Brief['tasks'][number]['scenario']): Brief['tasks'][number] => ({ key: 'T1', title: 't', spec: 's', kind: 'feature', scope: null, scenario, areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [] });

describe('completion inference', () => {
  test('coding goals get graph refresh + prd/readme; changelog when the file exists; questionnaire when decisions pend', () => {
    const ws = mkdtempSync(join(tmpdir(), 'foundry-infer-'));
    expect(inferCompletion({ ...briefBase, tasks: [task('frontend')] }, ws)).toMatchObject({ graphRefresh: true, docs: ['to-prd', 'readme-update'] });
    expect(inferCompletion({ ...briefBase, tasks: [task('general')] }, ws)).toMatchObject({ graphRefresh: false, docs: [] });
    writeFileSync(join(ws, 'CHANGELOG.md'), '# changelog\n');
    expect(inferCompletion({ ...briefBase, tasks: [task('backend')] }, ws).docs).toContain('changelog');
    const withDecision = { ...briefBase, tasks: [task('docs' as const)], questions: [{ id: 'q1', text: 'Which stack?', answer: 'Next.js', blocking: true, areaKey: null, options: ['Next.js', 'Laravel'], kind: 'text' as const, applied: false }] };
    expect(inferCompletion(withDecision, ws).docs).toContain('to-questionnaire');
  });
});

describe('autoskills retry for empty repositories', () => {
  test('skipped for no manifest at approval, runs after the task that creates one lands', async () => {
    const runner = new FakeRunner((spec) => {
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'package.json'), '{"name":"x"}');
    });
    const engine = track(new Engine(cfg(), runner));
    engine.autoskillsDeps = { spawn: fakeNpx as any, nodeVersion: async () => 'v22.1.0' };
    const goal = await engine.createGoal({ prompt: 'scaffold the project', repoPath: repo, autoBrief: { mustChecks: ['test -f package.json'] } });
    // recorded as skipped for lack of a manifest (not silently ignored)
    await waitFor(() => getGoal(engine.store.db, goal.id)?.autoskills?.status === 'skipped');
    expect(getGoal(engine.store.db, goal.id)!.autoskills!.detail).toContain('no stack manifest');
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    // the task created package.json → the retry after integrate installed the project skills
    await waitFor(() => getGoal(engine.store.db, goal.id)?.autoskills?.status === 'installed');
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.state).toBe('done');
    expect(g.autoskills!.skills).toContain('react');
    expect(existsSync(join(goalWorkspacePath(dataDir, goal.id), '.claude', 'skills', 'react', 'SKILL.md'))).toBe(true);
    await engine.stop();
    await Bun.sleep(100); // let queued ticks flush before afterEach removes the database
  });
});

describe('usage pause across restarts', () => {
  test('a pause with a future reset is re-armed; one that passed while down resumes immediately', async () => {
    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
    engine.pauseUntil(Date.now() + 60 * 60_000, 'five_hour', 'test');
    expect(engine.isRateLimited()).toBe(true);
    await engine.stop();
    // fresh engine over the same event log: still paused, no duplicate paused event
    const engine2 = track(new Engine(cfg(), new FakeRunner(() => {})));
    await engine2.start();
    expect(engine2.isRateLimited()).toBe(true);
    expect(engine2.store.listByType('rate_limit.paused', 10)).toHaveLength(1);
    await engine2.stop();

    const dataDir2 = mkdtempSync(join(tmpdir(), 'foundry-completion-data2-'));
    try {
      const cfg2 = () => defaultConfig(ROOT, { dataDir: dataDir2, claudeHome: join(dataDir2, 'claude-home'), log: () => {} });
      const a = track(new Engine(cfg2(), new FakeRunner(() => {})));
      a.store.append({ type: 'rate_limit.paused', goalId: null, payload: { rateLimitType: 'weekly', until: new Date(Date.now() - 60_000).toISOString(), reason: 'test' } });
      await a.stop();
      const b = track(new Engine(cfg2(), new FakeRunner(() => {})));
      await b.start();
      expect(b.isRateLimited()).toBe(false);
      const resumed = b.store.listByType('rate_limit.resumed', 1)[0]!;
      expect((resumed.payload as { reason: string }).reason).toContain('while the engine was down');
      await b.stop();
    } finally {
      rmSync(dataDir2, { recursive: true, force: true });
    }
  });
});

describe('docs generation', () => {
  test('writes docs, commits them as one docs: commit, discards non-doc changes', async () => {
    const runner = new FakeRunner((spec) => {
      if (spec.label?.startsWith('docs')) {
        mkdirSync(join(spec.cwd, 'docs', 'prd'), { recursive: true });
        writeFileSync(join(spec.cwd, 'docs', 'prd', 'goal.md'), '# PRD\n');
        writeFileSync(join(spec.cwd, 'junk.ts'), 'export const oops = 1;\n');
      }
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    engine.store.append({ type: 'goal.completion_set', goalId: goal.id, payload: { graphRefresh: false, docs: ['to-prd'], reason: 'test' } });
    await runDocsGeneration(engine, getGoal(engine.store.db, goal.id)!);
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.completion.docsRun).toMatchObject({ status: 'ok', files: ['docs/prd/goal.md'] });
    const ws = goalWorkspacePath(dataDir, goal.id);
    expect(existsSync(join(ws, 'junk.ts'))).toBe(false);
    const subject = (await Bun.$`git -C ${ws} log -1 --format=%s`.text()).trim();
    expect(subject).toStartWith('docs:');
    // a second call is a no-op (already recorded)
    const calls = runner.calls.length;
    await runDocsGeneration(engine, getGoal(engine.store.db, goal.id)!);
    expect(runner.calls.length).toBe(calls);
    await engine.stop();
  });
});

describe('fast pace', () => {
  test('fast goals skip the free task review; thorough goals get it', async () => {
    const behave = (spec: any) => {
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    };
    const cfgReview = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: true, log: () => {} });
    const fastRunner = new FakeRunner(behave);
    const fast = track(new Engine(cfgReview(), fastRunner));
    const g1 = await fast.createGoal({ prompt: 'quick', repoPath: repo, workflow: { pace: 'fast' }, autoBrief: { mustChecks: ['test -f done.txt'] } });
    expect(g1.workflow.pace).toBe('fast');
    expect(g1.workflow.tdd).toBe('off'); // fast defaults the TDD mandate off
    await waitFor(() => terminal(getGoal(fast.store.db, g1.id)!.state));
    expect(getGoal(fast.store.db, g1.id)!.state).toBe('done');
    expect(fastRunner.calls.some((c) => c.label?.startsWith('review'))).toBe(false);
    await fast.stop();

    const thoroughRunner = new FakeRunner(behave);
    const thorough = track(new Engine(cfgReview(), thoroughRunner));
    const g2 = await thorough.createGoal({ prompt: 'careful', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(thorough.store.db, g2.id)!.state));
    expect(thoroughRunner.calls.some((c) => c.label?.startsWith('review'))).toBe(true);
    await thorough.stop();
  }, 30_000);
});

describe('style direction', () => {
  test('the chosen proposal renders into worker and reviewer prompts, reference image included', async () => {
    const { chosenStyle } = await import('@foundry/core');
    const { renderStyle } = await import('./attempt-prompt.ts');
    const style = { key: 'S1', name: 'Warm izakaya night', palette: ['#2b1d16', '#e8a13c'], fonts: ['Noto Serif JP'], keywords: ['lantern light'], description: 'Cozy.', samples: ['artifacts/samples/S1-1.png', 'artifacts/samples/S1-2.png'], chosenSample: 'artifacts/samples/S1-2.png' };
    const brief = { ...briefBase, tasks: [task('image')], styleOptions: [style], questions: [{ id: 'q1', text: 'Which style direction should the deliverables follow?', answer: 'Warm izakaya night', blocking: true, areaKey: null, options: ['Warm izakaya night'], kind: 'style' as const, applied: false }] };
    expect(chosenStyle(brief)).toMatchObject({ key: 'S1' });
    const worker = renderStyle(chosenStyle(brief));
    expect(worker).toContain('#e8a13c');
    expect(worker).toContain('artifacts/samples/S1-2.png');
    expect(worker).toContain('manifest');
    const reviewer = renderStyle(chosenStyle(brief), { forReviewer: true });
    expect(reviewer).toContain('BLOCKER');
    // unanswered or missing question → no section
    expect(renderStyle(chosenStyle({ ...brief, questions: [] }))).toBe('');
  });
});

describe('media artifacts', () => {
  test('parallel media tasks: artifacts stay out of git, land in the goal workspace, and are delivered to the output folder at done', async () => {
    const { basename, join: j } = await import('node:path');
    const runner = new FakeRunner((spec) => {
      if (!spec.label?.startsWith('attempt')) return;
      const tag = basename(spec.cwd); // goal ws = _goal, task worktrees = task ids
      mkdirSync(j(spec.cwd, 'artifacts'), { recursive: true });
      writeFileSync(j(spec.cwd, 'artifacts', `${tag}.png`), 'png-bytes');
      mkdirSync(j(spec.cwd, 'docs', 'artifacts'), { recursive: true });
      writeFileSync(j(spec.cwd, 'docs', 'artifacts', `${tag}.md`), `# artifacts\n- ${tag}.png — test render`);
    });
    const engine = track(new Engine(cfg(), runner));
    const outputDir = mkdtempSync(join(tmpdir(), 'foundry-artifacts-out-'));
    try {
      const t = (key: string): Brief['tasks'][number] => ({ key, title: `render ${key}`, spec: `generate ${key}, manifest docs/artifacts/${key}.md`, kind: 'feature', scope: null, scenario: 'image', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: [], parallelizable: true, relevantFiles: [`docs/artifacts/${key}.md`] });
      const c = (key: string, taskKey: string): Brief['checks'][number] => ({ key: `C-${key}`, name: `artifacts exist for ${key}`, tier: 'must', taskKey, areaKey: null, spec: { type: 'command', cmd: 'test -d artifacts', timeoutMs: 300_000, expectExitCode: 0 } });
      const goal = await engine.createGoal({
        prompt: 'render two posters',
        repoPath: repo,
        nature: 'image',
        outputDir,
        brief: { ...briefBase, title: '', areas: [{ key: 'A1', name: 'Posters', slug: 'posters', description: '' }], tasks: [t('T1'), t('T2')], checks: [c('T1', 'T1'), c('T2', 'T2')] },
      });
      expect(goal.mode).toBe('simple'); // non-code goals open in the plain view
      await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
      const g = getGoal(engine.store.db, goal.id)!;
      expect(g.state).toBe('done');
      // both tasks' artifacts were rescued into the goal workspace and delivered to the output folder
      await waitFor(() => getGoal(engine.store.db, goal.id)!.completion.artifactsRun != null);
      const run = getGoal(engine.store.db, goal.id)!.completion.artifactsRun!;
      expect(run.status).toBe('ok');
      expect(run.files).toHaveLength(2);
      expect(run.dest).toBe(outputDir);
      for (const f of run.files) expect(existsSync(join(outputDir, f))).toBe(true);
      // nothing media-shaped reached git: the manifests are committed, the binaries are excluded
      const ws = goalWorkspacePath(dataDir, goal.id);
      const status = (await Bun.$`git -C ${ws} status --porcelain`.text()).trim();
      expect(status).toBe('');
      const tracked = (await Bun.$`git -C ${ws} ls-files artifacts docs/artifacts`.text()).trim().split('\n').filter(Boolean);
      expect(tracked.some((f) => f.endsWith('.png'))).toBe(false);
      expect(tracked.filter((f) => f.endsWith('.md'))).toHaveLength(2);
      await engine.stop();
      await Bun.sleep(100);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('graph refresh', () => {
  test('local mode runs in the goal workspace; tools not on PATH are recorded as skipped', async () => {
    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
    const goal = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    const ran: string[][] = [];
    await runGraphRefresh(engine, getGoal(engine.store.db, goal.id)!, {
      which: (n) => (n === 'graphify' ? '/fake/graphify' : null),
      exec: (async (cmd: string[], cwd: string) => {
        ran.push([...cmd, cwd]);
        return { code: 0, stdout: '', stderr: '' };
      }) as any,
    });
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.completion.graphRun!.tools).toEqual([
      { name: 'graphify', status: 'ok', detail: expect.stringContaining('update') },
      { name: 'gitnexus', status: 'skipped', detail: 'not on PATH' },
    ]);
    // local mode: no pull of the user's checkout, runs in the goal workspace
    expect(ran[0]![2]).toBe(goalWorkspacePath(dataDir, goal.id));
    await engine.stop();
  });
});
