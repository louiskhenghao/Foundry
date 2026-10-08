import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeliveryPolicy, IDLE_DELIVERY, getGoal, type Goal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { FakeGh } from '../delivery/gh.fake.ts';
import { checkOpenPrs } from '../delivery/pr-watch.ts';
import { Engine } from '../engine.ts';
import { transferGoalDir } from './paths.ts';
import { FakeRunner, makeRepo, sh } from '../test-helpers.ts';
import { relocateLegacyWorkspaces } from '../workspace-migrate.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
const track = <T extends Engine>(e: T) => (engines.push(e), e);
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-history-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [dataDir, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

const t0 = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m)).toISOString();
/** a goal as another computer had it; repoPath is a real repository here, as when the same path exists on both */
function goal(id: string, state: Goal['state'], delivery = IDLE_DELIVERY): Goal {
  return {
    provider: 'claude', id, title: 'imported', prompt: 'p', workspaceDir: null, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: repo, baseBranch: 'main', branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state, stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery, attachments: [], baseSync: null, autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'code', outputDir: null, runningSince: t0(0), createdAt: t0(0), updatedAt: t0(0),
  };
}
function importHistory(engine: Engine, g: Goal, extra: { type: string; payload: unknown }[] = []) {
  engine.store.importGoalEvents(g.id, [{ type: 'goal.created', payload: { goal: g } }, ...extra].map((e, i) => ({ id: `${g.id}_${i}`, ts: t0(i), goalId: g.id, ...e })));
  engine.store.append({ type: 'goal.imported', goalId: g.id, payload: { transferId: 'tr', from: { release: '1.0.0', hostname: 'old', exportedAt: t0(30) }, unfinished: !['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state), bundle: null, artifacts: null, transcripts: false, remap: {} } });
}

describe('history goals (ADR-0030)', () => {
  test('the engine leaves Imported Goals alone: no sessions, no delivery, no PR polling, no folder moves', async () => {
    const runner = new FakeRunner(() => {});
    const gh = new FakeGh();
    // the repository has a GitHub remote, so an open pull request would be read there
    await sh('git remote add origin https://github.com/acme/app.git', repo);
    const viewed: number[] = [];
    gh.prView = async (_cwd, i) => (viewed.push(i.number), Promise.reject(new Error('not on GitHub')));
    const engine = track(new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), log: () => {} }), runner, gh));
    const pr = DeliveryPolicy.parse({ mode: 'pr' });
    // a draft (would start Clarify), a running goal with a live-looking attempt (reconcile would conclude it), a done goal
    // waiting for delivery (would deliver) and one with an open pull request (would be polled on GitHub)
    importHistory(engine, goal('g_draft', 'draft'));
    importHistory(engine, goal('g_run', 'running'), [
      { type: 'task.created', payload: { task: { id: 't_run', goalId: 'g_run', title: 't', spec: 's', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 3, origin: 'brief', state: 'running', branch: null, worktreePath: null, hint: null, extraAttempts: 0, createdAt: t0(1), updatedAt: t0(1) } } },
      { type: 'attempt.started', payload: { attempt: { id: 'a_run', goalId: 'g_run', taskId: 't_run', index: 1, kind: 'work', sessionId: 's', model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: 2 ** 22 + 17, cwd: null, transcriptPath: null, startedAt: t0(2), endedAt: null } } },
    ]);
    importHistory(engine, goal('g_done', 'done', { ...IDLE_DELIVERY, policy: pr }));
    importHistory(engine, goal('g_pr', 'done', { ...IDLE_DELIVERY, policy: pr, status: 'delivered', outcome: 'pr_open', finishedAt: new Date().toISOString(), prs: [{ taskId: null, index: 1, branch: 'goal/g_pr', base: 'main', title: 't', number: 7, url: 'u', state: 'open', checks: null, mergedRef: null, failing: [], activity: null, ciSkipped: false, branchDeleted: false, sync: null }] }));
    const ids = ['g_draft', 'g_run', 'g_done', 'g_pr'];
    const events = () => ids.map((id) => engine.store.listByGoal(id).length);
    const before = events();
    // what start() does to goals, without its background work (model sync, sweepers, timers)
    await (engine as unknown as { reconcile(): Promise<void> }).reconcile();
    await relocateLegacyWorkspaces(engine);
    await checkOpenPrs(engine);
    for (const id of ids) engine.tick(id);
    await new Promise((r) => setTimeout(r, 300));
    expect(runner.calls).toEqual([]);
    expect(gh.calls).toEqual([]);
    expect(viewed).toEqual([]);
    expect(events()).toEqual(before);
    expect(getGoal(engine.store.db, 'g_draft')?.state).toBe('draft');
    expect(getGoal(engine.store.db, 'g_run')?.workspaceDir).toBeNull();
  });

  test('a repository that was never mapped is not touched: no preview, and deleting the goal leaves that path\'s branches alone', async () => {
    const engine = track(new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), log: () => {} }), new FakeRunner(() => {})));
    // the same path exists here and even has a branch of that name: it is someone else's checkout until it is mapped
    await sh('git branch goal/g_far', repo);
    importHistory(engine, goal('g_far', 'done'));
    mkdirSync(transferGoalDir(dataDir, 'g_far'), { recursive: true });
    writeFileSync(join(transferGoalDir(dataDir, 'g_far'), 'branch.bundle'), 'x');
    await expect(engine.preview.start(getGoal(engine.store.db, 'g_far')!, 'human')).rejects.toThrow(/map its repository/);
    await engine.deleteGoal('g_far', { deleteBranch: true });
    expect(await sh('git branch --list goal/g_far', repo)).toContain('goal/g_far');
    expect(existsSync(transferGoalDir(dataDir, 'g_far'))).toBe(false);
    expect(getGoal(engine.store.db, 'g_far')).toBeNull();
  });

  test('nothing written about an Imported Goal is sent as a notification', async () => {
    const engine = track(new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), log: () => {} }), new FakeRunner(() => {})));
    engine.updateSettings({ notifications: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/x' } });
    const sent: string[] = [];
    (engine.notifications as unknown as { deliver: (s: unknown, text: string) => void }).deliver = (_s, text) => void sent.push(text);
    importHistory(engine, goal('g_quiet', 'running'));
    engine.store.append({ type: 'delivery.failed', goalId: 'g_quiet', payload: { step: 'push', reason: 'cut off by the Transfer' } });
    engine.store.append({ type: 'goal.state_changed', goalId: 'g_quiet', payload: { from: 'running', to: 'failed', reason: 'x' } });
    expect(sent).toEqual([]);
  });
});

