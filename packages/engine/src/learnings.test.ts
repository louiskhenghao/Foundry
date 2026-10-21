import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Learning } from '@foundry/core';
import { getGoal, getRepoLearnings, listRepoLearnings } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { everywhereLearnings, learningsContext, learningsForWorker, mergeLearnings } from './learnings.ts';
import { LEARNINGS_SKILL, exportLearningsSkill, renderLearningsSkill } from './learnings-skill.ts';
import { FakeRunner, makeRepo, terminal, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const goal = { id: 'g_new', title: 'Add dark mode' };
const L = (over: Partial<Learning>): Learning => ({ id: 'lrn_1', kind: 'build', text: 'Run pnpm install first.', by: 'foundry', goalId: 'g_old', goalTitle: 'Old goal', at: '2026-10-01T00:00:00Z', ...over });

describe('merging what a goal taught', () => {
  test("the person's entries stay word for word, whatever the session did to them", () => {
    const mine = L({ id: 'lrn_h', by: 'human', kind: 'preference', text: 'Prefer server components.', goalId: null, goalTitle: null });
    const merged = mergeLearnings([mine, L({})], [{ id: 'lrn_h', kind: 'pitfall', text: 'rewritten by the model' }, { id: 'lrn_1', kind: 'build', text: 'Run pnpm install first.' }], goal);
    expect(merged[0]).toEqual(mine);
    expect(merged.map((l) => l.text)).toEqual(['Prefer server components.', 'Run pnpm install first.']);
    // dropped by the session: still there
    expect(mergeLearnings([mine], [], goal)).toEqual([mine]);
  });

  test('a kept entry keeps its origin, a rewrite keeps its goal, a new one is this goal’s; repeats and empties go; long text is clipped', () => {
    const merged = mergeLearnings(
      [L({}), L({ id: 'lrn_2', kind: 'test', text: 'Tests need the dev server.' })],
      [
        { id: 'lrn_1', kind: 'build', text: 'Run pnpm install first.' },
        { id: 'lrn_2', kind: 'test', text: 'E2E tests need `pnpm dev` on :5173.' },
        { id: null, kind: 'pitfall', text: 'The i18n keys must exist in en and zh.' },
        { id: null, kind: 'pitfall', text: '  the I18N keys must exist in en and zh. ' },
        { id: null, kind: 'run', text: '   ' },
        { id: null, kind: 'structure', text: 'x'.repeat(400) },
      ],
      goal,
      '2026-10-18T00:00:00Z',
    );
    expect(merged[0]).toEqual(L({}));
    expect(merged[1]).toMatchObject({ id: 'lrn_2', text: 'E2E tests need `pnpm dev` on :5173.', goalId: 'g_old', by: 'foundry', at: '2026-10-18T00:00:00Z' });
    expect(merged[2]).toMatchObject({ kind: 'pitfall', goalId: 'g_new', goalTitle: 'Add dark mode', by: 'foundry' });
    expect(merged).toHaveLength(4);
    expect(merged[3]!.text.length).toBe(300);
  });

  test('at most thirty', () => {
    const out = Array.from({ length: 40 }, (_, i) => ({ id: null, kind: 'build' as const, text: `fact ${i}` }));
    expect(mergeLearnings([], out, goal)).toHaveLength(30);
  });
});

describe('what later goals are given', () => {
  let dataDir: string;
  let engine: Engine;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-learnings-'));
    engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), new ScriptRunner(() => null));
  });
  afterEach(async () => {
    await engine.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('Clarify gets the whole notebook, the person’s first; a task gets it short, the operational kinds first', () => {
    engine.setLearnings('/repo', [
      { kind: 'structure', text: 'Pages live in src/routes.' },
      { kind: 'build', text: 'Run pnpm install first.' },
    ]);
    const ctx = learningsContext(engine, { repoPath: '/repo' });
    expect(ctx).toContain('# What Foundry learned about this repository');
    expect(ctx).toContain('- [structure] ✎ Pages live in src/routes.');
    const worker = learningsForWorker(engine, { repoPath: '/repo' });
    expect(worker.split('\n').slice(2)).toEqual(['- Run pnpm install first.', '- Pages live in src/routes.']);
    expect(learningsForWorker(engine, { repoPath: '/repo' }, 30).split('\n').slice(2)).toEqual(['- Run pnpm install first.']);
    expect(learningsContext(engine, { repoPath: '/other' })).toBe('');
  });

  test("the person's edit: what they write or change is theirs, what they leave is kept, an empty list clears the folder", () => {
    engine.store.append({ type: 'learnings.set', goalId: null, payload: { repoPath: '/repo', learnings: [L({}), L({ id: 'lrn_2', text: 'Old fact.' })], source: 'distill', goalId: 'g_old', note: null } });
    const after = engine.setLearnings('/repo', [
      { id: 'lrn_1', kind: 'build', text: 'Run pnpm install first.' },
      { id: 'lrn_2', kind: 'build', text: 'A fact I corrected.' },
      { kind: 'preference', text: 'No new dependencies without asking.' },
    ]);
    expect(after[0]).toEqual(L({}));
    expect(after[1]).toMatchObject({ id: 'lrn_2', by: 'human', text: 'A fact I corrected.', goalId: 'g_old' });
    expect(after[2]).toMatchObject({ by: 'human', goalId: null, kind: 'preference' });
    expect(() => engine.setLearnings('/repo', [{ kind: 'build', text: 'x'.repeat(301) }])).toThrow(/at most 300/);
    engine.setLearnings('/repo', []);
    expect(getRepoLearnings(engine.store.db, '/repo')).toBeNull();
    // the notebook is a read model of its events: a replay rebuilds it
    engine.setLearnings('/repo', [{ kind: 'run', text: 'bun dev serves on :3000.' }]);
    const before = listRepoLearnings(engine.store.db);
    engine.store.replay();
    expect(listRepoLearnings(engine.store.db)).toEqual(before);
  });
});

/** answers each session by its label: `learn` for the learning session, success with no output for the rest */
class ScriptRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private learn: (spec: RunSpec) => unknown) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = spec.label?.startsWith('learnings') ? this.learn(spec) : null;
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: structuredOutput ? JSON.stringify(structuredOutput) : 'done', structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

describe('learning when a goal ends', () => {
  let dataDir: string;
  let repo: string;
  const engines: Engine[] = [];
  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-learnings-'));
    repo = await makeRepo();
  });
  afterEach(async () => {
    for (const e of engines.splice(0)) await e.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  });
  const make = (runner: ClaudeRunner) => {
    const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), runner);
    engines.push(e);
    return e;
  };

  test('a finished goal teaches its folder; the next goal there is told; the session runs without tools on the cheap model', async () => {
    const runner = new ScriptRunner(() => ({ learnings: [{ id: null, kind: 'test', text: 'Checks run with `true`; nothing to install.' }], note: 'Added how the checks run.' }));
    const engine = make(runner);
    const first = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, first.id)!.state));
    await waitFor(() => engine.learnings(repo).length === 1);
    const learnt = engine.learnings(repo)[0]!;
    expect(learnt).toMatchObject({ kind: 'test', by: 'foundry', goalId: first.id, goalTitle: getGoal(engine.store.db, first.id)!.title });
    const session = runner.calls.find((c) => c.label?.startsWith('learnings'))!;
    // it may read the goal's transcripts and call a skill, nothing else; without the retro skill it is a plain session
    expect(session.allowedTools).toEqual(['Read', 'Skill']);
    expect(session.prompt.startsWith('/')).toBe(false);
    expect(session.prompt).toContain('# Primary sources');
    expect(session.prompt).toContain(join(dataDir, 'transcripts'));
    expect(session.model).toBe(getGoal(engine.store.db, first.id)!.models.cheap);
    expect(session.prompt).toContain('# The notebook of this repository so far\n(empty)');
    expect(engine.store.listByGoal(first.id, 2000).some((e) => e.type === 'engine.note' && (e.payload as { message: string }).message.startsWith('Learnings for this folder: +1 — Added how the checks run.'))).toBe(true);
    // the event is global: a Transfer of the goal does not carry this computer's notebook
    expect(engine.store.listByType('learnings.set', 5)[0]!.goalId).toBeNull();

    const second = await engine.createGoal({ prompt: 'noop again', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, second.id)!.state));
    const attempt = runner.calls.find((c) => c.label?.startsWith('attempt') && c.prompt.includes('noop again'));
    expect(attempt?.prompt).toContain('# Notes on this repository\n');
    expect(attempt?.prompt).toContain('- Checks run with `true`; nothing to install.');
    // the second learning session saw the notebook so far, and nothing new is fine
    await waitFor(() => runner.calls.filter((c) => c.label?.startsWith('learnings')).length === 2);
    expect(runner.calls.filter((c) => c.label?.startsWith('learnings'))[1]!.prompt).toContain('Checks run with `true`');
  }, 60_000);

  test('with the retro skill installed for a Claude goal, the session opens as a retrospective and its categories are the lens', async () => {
    // a plugin that ships retro and writing-for-agents, as a marketplace install leaves it
    const home = join(dataDir, 'claude-home');
    const plug = join(home, 'plugins', 'cache', 'mkt', 'mp-skills', '1.3.1');
    for (const [dir, name, extra] of [['engineering/retro', 'retro', 'disable-model-invocation: true\n'], ['productivity/writing-for-agents', 'writing-for-agents', '']] as const) {
      mkdirSync(join(plug, 'skills', dir), { recursive: true });
      writeFileSync(join(plug, 'skills', dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n${extra}---\n# ${name}\n`);
    }
    mkdirSync(join(plug, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plug, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mp-skills', skills: ['./skills/engineering/retro', './skills/productivity/writing-for-agents'] }));
    writeFileSync(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'mp-skills@mkt': [{ scope: 'user', installPath: plug, version: '1.3.1' }] } }));
    const runner = new ScriptRunner(() => ({ learnings: [], note: 'Nothing new.' }));
    const engine = make(runner);
    const g = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, g.id)!.state));
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('learnings')));
    const session = runner.calls.find((c) => c.label?.startsWith('learnings'))!;
    expect(session.prompt.startsWith('/mp-skills:retro ')).toBe(true);
    expect(session.prompt).toContain('navigation, automated checks, coding standards');
    expect(session.prompt).toContain('- Prefer: invoke `/mp-skills:writing-for-agents`');
    expect(session.maxTurns).toBeGreaterThanOrEqual(6);
  }, 60_000);

  test("the folder's Learnings are a project skill for the person's own sessions: it follows every change and leaves with the last entry", async () => {
    const runner = new ScriptRunner(() => ({ learnings: [{ id: null, kind: 'test', text: 'Run bun test ./packages.' }], note: 'n' }));
    const engine = make(runner);
    const g = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, g.id)!.state));
    await waitFor(() => engine.learnings(repo).length > 0);
    const claude = join(repo, '.claude', 'skills', 'foundry-learnings', 'SKILL.md');
    const codex = join(repo, '.agents', 'skills', 'foundry-learnings', 'SKILL.md');
    await waitFor(() => existsSync(claude) && existsSync(codex));
    const text = readFileSync(claude, 'utf8');
    expect(text).toContain('name: foundry-learnings');
    expect(text).toContain('## How to build, test and run it');
    expect(text).toContain('- Run bun test ./packages.');
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/skills/foundry-learnings/');
    // the person's edit is theirs, and marked so
    engine.setLearnings(repo, [{ kind: 'preference', text: 'Keep the README short.' }]);
    await waitFor(() => readFileSync(claude, 'utf8').includes('- ✎ Keep the README short.'));
    // the switch removes the file; back on, it returns
    engine.updateSettings({ workflow: { learningsSkill: false } });
    await waitFor(() => !existsSync(claude) && !existsSync(codex));
    engine.updateSettings({ workflow: { learningsSkill: true } });
    await waitFor(() => existsSync(claude));
    // an empty notebook removes it
    engine.setLearnings(repo, []);
    await waitFor(() => !existsSync(claude));
    // a goal starting in the folder rewrites a file that went missing
    engine.setLearnings(repo, [{ kind: 'build', text: 'Install with bun install.' }]);
    await waitFor(() => existsSync(claude));
    rmSync(join(repo, '.claude', 'skills', 'foundry-learnings'), { recursive: true, force: true });
    await engine.createGoal({ prompt: 'noop again', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => existsSync(claude));
    expect(readFileSync(claude, 'utf8')).toContain('- ✎ Install with bun install.');
  }, 60_000);

  test("a goal on the pstack suite reflects in one session: reflect's lenses as text, no retro opener", async () => {
    const runner = new ScriptRunner(() => ({ learnings: [], note: 'Nothing new.' }));
    const engine = make(runner);
    const g = await engine.createGoal({ prompt: 'noop', repoPath: repo, workflow: { profile: 'pstack' }, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, g.id)!.state));
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('learnings')));
    const session = runner.calls.find((c) => c.label?.startsWith('learnings'))!;
    expect(session.prompt.startsWith("In the manner of pstack's reflect")).toBe(true);
    expect(session.prompt).toContain("reflect's lenses");
    expect(session.prompt).not.toContain('navigation, automated checks');
  }, 60_000);

  test('with learning off nothing runs at the end, but the person can still ask; a cancelled goal teaches nothing', async () => {
    const runner = new ScriptRunner(() => ({ learnings: [{ id: null, kind: 'run', text: 'A fact.' }], note: 'n' }));
    const engine = make(runner);
    engine.updateSettings({ workflow: { learnings: false } });
    const g = await engine.createGoal({ prompt: 'noop', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, g.id)!.state));
    await Bun.sleep(100);
    expect(runner.calls.some((c) => c.label?.startsWith('learnings'))).toBe(false);
    await engine.learnFrom(g.id);
    expect(engine.learnings(repo).map((l) => l.text)).toEqual(['A fact.']);
    // a goal still at work has nothing to teach yet
    const busy = await engine.createGoal({ prompt: 'still clarifying', repoPath: repo });
    expect(() => engine.learnFrom(busy.id)).toThrow(/teaches its folder once it ended/);
    engine.cancelGoal(busy.id);
  }, 60_000);
});

describe("the person's everywhere notebook (ADR-0055)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-learnings-everywhere-'));
  });
  const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
  test('given to every goal with the folder’s notebook, apart from it in Clarify’s section, first in the short form; never a folder’s own', () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.setLearnings('*', [{ kind: 'preference', text: 'Use bun, never npm.' }, { kind: 'convention', text: 'Comments in Chinese.' }]);
    engine.setLearnings('/repo', [{ kind: 'build', text: 'Run pnpm install first.' }]);
    expect(everywhereLearnings(engine).map((l) => [l.text, l.by])).toEqual([
      ['Use bun, never npm.', 'human'],
      ['Comments in Chinese.', 'human'],
    ]);
    expect(engine.learnings('/repo').map((l) => l.text)).toEqual(['Run pnpm install first.']);
    const ctx = learningsContext(engine, { repoPath: '/repo' });
    expect(ctx).toContain('- [build] ✎ Run pnpm install first.');
    expect(ctx).toContain('What the person wants in every project, whatever the folder (✎):\n- [preference] ✎ Use bun, never npm.\n- [convention] ✎ Comments in Chinese.');
    // a folder with nothing of its own still gets the everywhere entries
    expect(learningsContext(engine, { repoPath: '/other' })).toContain('- [preference] ✎ Use bun, never npm.');
    const worker = learningsForWorker(engine, { repoPath: '/repo' }).split('\n').slice(2);
    expect(worker).toEqual(['- Run pnpm install first.', '- Use bun, never npm.', '- Comments in Chinese.']);
    expect(learningsForWorker(engine, { repoPath: '/other' }).split('\n').slice(2)).toEqual(['- Use bun, never npm.', '- Comments in Chinese.']);
    // the read model keeps it apart from the folders
    expect(listRepoLearnings(engine.store.db).map((r) => r.repoPath).sort()).toEqual(['*', '/repo']);
    expect(() => engine.setLearnings('*', Array.from({ length: 31 }, (_, i) => ({ kind: 'preference' as const, text: `wish ${i}` })))).toThrow(/everywhere notebook keeps at most 30/);
  });
});

describe("the everywhere notebook in every folder's exported skill (ADR-0055)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-learnings-skill-everywhere-'));
  });
  const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
  test('a folder with nothing of its own gets the skill for the everywhere entries; a change of them rewrites it; the last entry gone removes it', async () => {
    const repo = await makeRepo();
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    const file = join(repo, '.claude/skills', LEARNINGS_SKILL, 'SKILL.md');
    expect(await exportLearningsSkill(engine, repo)).toBe('unchanged');
    expect(existsSync(file)).toBe(false);
    engine.setLearnings('*', [{ kind: 'preference', text: 'Use bun, never npm.' }]);
    expect(await exportLearningsSkill(engine, repo)).toBe('written');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('## What the person wants in every project');
    expect(text).toContain('- ✎ Use bun, never npm.');
    expect(text).toContain('(1 entry,');
    engine.setLearnings(repo, [{ kind: 'build', text: 'Run bun install first.' }]);
    expect(await exportLearningsSkill(engine, repo)).toBe('written');
    const both = readFileSync(file, 'utf8');
    expect(both.indexOf('## How to build, test and run it')).toBeLessThan(both.indexOf('## What the person wants in every project'));
    expect(both).toContain('(2 entries,');
    engine.setLearnings(repo, []);
    engine.setLearnings('*', []);
    expect(await exportLearningsSkill(engine, repo)).toBe('removed');
    expect(existsSync(file)).toBe(false);
    expect(renderLearningsSkill([], '2026-10-21T00:00:00Z', [{ id: 'l', kind: 'preference', text: 'x', by: 'human', goalId: null, goalTitle: null, at: 'now' }])).toContain('## What the person wants in every project\n\n- ✎ x');
  });
});
