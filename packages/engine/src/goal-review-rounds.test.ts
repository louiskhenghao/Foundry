import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listEscalations, listTasks, type EngineEvent } from '@foundry/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { reviewRounds, standingText } from './goal-review.ts';
import { FakeRunner, makeRepo, waitFor } from './test-helpers.ts';

let n = 0;
const ev = (type: string, payload: Record<string, unknown>): EngineEvent => ({ id: `e${++n}`, ts: '2026-11-19T20:00:00.000Z', goalId: 'g1', type, payload }) as unknown as EngineEvent;
const cost = (costUsd: number, source = 'attempt:a1') => ev('goal.cost_added', { costUsd, source });
/** a review's verdict with these checks failing (and the rest passing) */
const review = (failing: string[], passing: string[] = []) =>
  ev('review.goal.finished', { passed: false, mustResults: [...failing.map((checkId) => ({ checkId, status: 'fail' })), ...passing.map((checkId) => ({ checkId, status: 'pass' }))] });
const name = (id: string) => ({ wizard: '连接向导一键接入', dept: '装修中的部门', column: '右侧一列与详情页签', company: '公司模式' }[id] ?? id);

describe('the standing of a goal whose review failed with no fix cycle left', () => {
  test('rounds, what the last fix round cost (between the two verdicts, Conversation answers left out) and how the failures moved', () => {
    // the pattern of a 2026-11-19 goal: the second review fails on checks the first one passed
    const events = [cost(12), review(['wizard', 'dept', 'column'], ['company']), cost(40), cost(9.5, 'review-task:a2'), cost(3, 'conversation'), cost(10.25, 'goal-review'), review(['wizard', 'company'], ['dept', 'column'])];
    expect(reviewRounds(events, name)).toEqual({ rounds: 2, lastRoundUsd: 59.75, newlyFailing: ['公司模式'], nowPassing: ['装修中的部门', '右侧一列与详情页签'] });
  });

  test('the same checks failing again is no moving target; one review alone has no last round', () => {
    expect(reviewRounds([review(['wizard']), cost(5), review(['wizard'])], name)).toMatchObject({ rounds: 2, newlyFailing: [], nowPassing: [] });
    expect(reviewRounds([cost(1), review(['wizard'])], name)).toEqual({ rounds: 1, lastRoundUsd: null, newlyFailing: [], nowPassing: [] });
  });

  test('what the escalation says: the spend and the round in dollars where the agent reports them, and the advice when failures move', () => {
    const moving = { rounds: 3, lastRoundUsd: 81.4, newlyFailing: ['镜头平移顺手'], nowPassing: ['连接向导一键接入'] };
    const text = standingText(moving, 302.5, true);
    expect(text).toContain('Review 3 of this goal.');
    expect(text).toContain('The goal has spent $302.50 so far; the last fix round and this review cost $81.40');
    expect(text).toContain('newly failing 镜头平移顺手; now passing 连接向导一键接入');
    expect(text).toContain('another fix round is unlikely to settle it');
    // Codex and Antigravity report no dollars: no amounts, the rest stays
    const codex = standingText(moving, 0, false);
    expect(codex).not.toContain('$');
    expect(codex).toContain('unlikely to settle it');
    // nothing moved: the round and the spend only
    expect(standingText({ rounds: 2, lastRoundUsd: 20, newlyFailing: [], nowPassing: [] }, 60, true)).not.toContain('unlikely');
  });
});

describe('a goal review out of fix cycles says where the goal stands, end to end', () => {
  const ROOT = resolve(import.meta.dir, '../../..');
  let dataDir = '';
  let repo = '';
  let engine: Engine | undefined;
  afterEach(async () => {
    await engine?.stop();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  });

  test('a failed goal review with no fix cycle to spend asks the person, saying the round and the spend', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-review-rounds-'));
    repo = await makeRepo();
    engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, maxFixCycles: 0, log: () => {} }), new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'work.txt'), 'x')));
    const task = { key: 'T1', title: 'write it', spec: 'write a file', kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: [], parallelizable: false, relevantFiles: [] };
    const never = { key: 'G1', name: 'never passes', tier: 'must' as const, taskKey: null, areaKey: null, spec: { type: 'command' as const, cmd: 'test -f never.txt', timeoutMs: 60_000, expectExitCode: 0 } };
    const goal = await engine.createGoal({ prompt: 'write it', repoPath: repo, brief: { title: '', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [task], checks: [never] } });
    await waitFor(() => listEscalations(engine!.store.db, { goalId: goal.id }).length > 0, 60_000);
    expect(listTasks(engine.store.db, goal.id).filter((t) => t.origin === 'goal-review-fix')).toHaveLength(0);
    const esc = listEscalations(engine.store.db, { goalId: goal.id })[0]!;
    expect(esc.trigger).toBe('retries_exhausted');
    expect(esc.message).toContain('Goal review failed after 0 fix cycle(s). Failing Must checks: never passes');
    expect(esc.message).toMatch(/Review 1 of this goal\. The goal has spent \$\d+\.\d\d so far\.$/);
    // one review: no round before it to cost, nothing that moved
    expect(esc.payload).toMatchObject({ kind: 'goal-review', rounds: 1, lastRoundUsd: null, newlyFailing: [], nowPassing: [] });
  }, 90_000);
});
