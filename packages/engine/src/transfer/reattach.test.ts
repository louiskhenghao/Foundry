import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, isHistory, listAttempts, type Goal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, waitFor } from '../test-helpers.ts';
import { engineTransferHost, exportTransfer } from './export.ts';
import { applyIncoming, receiveTransfer } from './import.ts';
import { mapRepo } from './reattach.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let tmp: string;
let repo: string;
let clone: string;
const engines: Engine[] = [];
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'foundry-reattach-'));
  repo = await makeRepo();
  clone = join(tmp, 'checkout-here');
  await sh(`git clone -q ${repo} ${clone}`, tmp);
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [tmp, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

function engine(name: string, runner: FakeRunner) {
  const dataDir = join(tmp, name);
  const e = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), codexHome: join(dataDir, 'codex-home'), alwaysReviewTasks: false, log: () => {} }), runner);
  engines.push(e);
  return e;
}

/**
 * The old computer: a goal whose first task landed (its work is on the local goal branch) and whose second task's
 * attempt was running when the file was written. Its media artifacts sit git-excluded in the progress folder.
 */
async function exportHalfDone(): Promise<{ file: string; goal: Goal }> {
  let block = true;
  const a = engine('a', new FakeRunner(async (spec) => {
    if (spec.prompt.includes('second.txt')) while (block) await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(spec.cwd, spec.prompt.includes('second.txt') ? 'second.txt' : 'first.txt'), 'ok');
  }));
  const g = await a.createGoal({ prompt: 'two steps', repoPath: repo, brief: undefined, autoBrief: { mustChecks: ['test -f first.txt'] } });
  await waitFor(() => ['done', 'over_delivered'].includes(getGoal(a.store.db, g.id)!.state), 30_000);
  // turn the finished goal into one cut off mid-work: a second task whose attempt is running right now
  a.beginUpdateDrain();
  const now = new Date().toISOString();
  a.store.append({ type: 'goal.state_changed', goalId: g.id, payload: { from: getGoal(a.store.db, g.id)!.state, to: 'running', reason: 'test: more work' } });
  a.store.append({ type: 'task.created', goalId: g.id, payload: { task: { id: 't_second', goalId: g.id, title: 'create second.txt', spec: 'create second.txt', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 2, origin: 'brief', state: 'running', branch: null, worktreePath: null, hint: null, extraAttempts: 0, createdAt: now, updatedAt: now } as never } });
  a.store.append({ type: 'attempt.started', goalId: g.id, payload: { attempt: { id: 'a_second', goalId: g.id, taskId: 't_second', index: 1, kind: 'work', sessionId: 'sess-old', model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: now, endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } } });
  const ws = getGoal(a.store.db, g.id)!.workspaceDir!;
  await sh('mkdir -p artifacts/samples && echo png > artifacts/samples/pick.png', ws);
  block = false;
  const file = join(tmp, 'move.tgz');
  await exportTransfer(engineTransferHost(a), { categories: { goals: true }, out: file });
  await a.stop();
  return { file, goal: getGoal(a.store.db, g.id)! };
}

describe('mapping and Reattach (ADR-0030)', () => {
  test('an Imported Goal mapped to another checkout gets its branch back there', async () => {
    const { file, goal } = await exportHalfDone();
    const runner = new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'second.txt'), 'ok'));
    const b = engine('b', runner);
    const incoming = await receiveTransfer(b, file);
    // leave it unmapped at import, as for a repository that lives elsewhere here
    await applyIncoming(b, incoming.uploadId, { repos: { [repo]: null } });

    const mapped = await mapRepo(b, repo, clone);
    expect(mapped).toMatchObject({ to: clone, goals: [goal.id], restored: [goal.id] });
    expect(await sh(`git show ${goal.branch}:first.txt`, clone)).toBe('ok');
    expect(getGoal(b.store.db, goal.id)!.repoPath).toBe(clone);
    expect(isHistory(getGoal(b.store.db, goal.id)!)).toBe(true);

  });

  test('a branch of that name with other commits is never overwritten, and nothing is mapped then', async () => {
    const { file, goal } = await exportHalfDone();
    const b = engine('b', new FakeRunner(() => {}));
    const incoming = await receiveTransfer(b, file);
    await applyIncoming(b, incoming.uploadId, { repos: { [repo]: null } });
    await sh(`git checkout -q -b ${goal.branch} && echo other > other.txt && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m other && git checkout -q main`, clone);
    await expect(mapRepo(b, repo, clone)).rejects.toThrow('already has a branch');
    expect(getGoal(b.store.db, goal.id)!.transfer?.repoMapped).toBeNull();
    await expect(mapRepo(b, repo, join(tmp, 'nowhere'))).rejects.toThrow('not a git checkout');
    expect(existsSync(join(tmp, 'b', 'transfer', 'goals', goal.id, 'branch.bundle'))).toBe(true);
  });
});
