import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, makeRepoWithRemote, sh, terminal, waitFor } from '../test-helpers.ts';
import { fetchBase, pullFastForward, startRef } from './sync.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let repo: string;
let bare: string;
beforeEach(async () => {
  ({ repo, bare } = await makeRepoWithRemote());
});

/** push a commit to the bare remote's main from a second clone, so the local repo falls behind */
async function upstreamCommit(file = 'upstream.txt') {
  const other = mkdtempSync(join(tmpdir(), 'foundry-sync-other-'));
  await sh(`git clone -q ${bare} . && printf 'new\\n' > ${file} && git add -A && git -c user.name=o -c user.email=o@o commit -qm "feat: ${file}" && git push -q origin main`, other);
}

describe('base branch sync', () => {
  test('fetchBase measures ahead/behind without touching the checkout; startRef picks the remote only when strictly behind', async () => {
    const same = await fetchBase(repo, 'main');
    expect(same).toMatchObject({ remote: 'origin', fetched: true, ahead: 0, behind: 0 });
    expect(startRef(same).from).toBe('local');

    await upstreamCommit();
    const behind = await fetchBase(repo, 'main');
    expect(behind).toMatchObject({ ahead: 0, behind: 1, fetched: true });
    expect(behind.localRef).not.toBe(behind.remoteRef);
    expect(startRef(behind)).toMatchObject({ ref: 'origin/main', from: 'remote' });
    expect(startRef(behind, 'local').from).toBe('local');
    // the local branch and working tree did not move
    expect(await sh('git rev-parse main', repo)).toBe(behind.localRef!);
    expect(await sh('git status --porcelain', repo)).toBe('');

    // diverged: local commit too → stay local
    writeFileSync(join(repo, 'local.txt'), 'x');
    await sh('git add -A && git -c user.name=t -c user.email=t@t commit -qm "feat: local"', repo);
    const diverged = await fetchBase(repo, 'main');
    expect(diverged).toMatchObject({ ahead: 1, behind: 1 });
    expect(startRef(diverged).from).toBe('local');
    expect(startRef(diverged).reason).toContain('diverged');
  });

  test('no remote → local, no fetch, no error', async () => {
    const lonely = await makeRepo();
    const s = await fetchBase(lonely, 'main');
    expect(s).toMatchObject({ remote: null, fetched: false, remoteRef: null, error: null });
    expect(startRef(s)).toMatchObject({ from: 'local', reason: 'no remote' });
  });

  test('pullFastForward: ff when clean, refuses dirty or diverged, moves a non-checked-out branch by ref', async () => {
    await upstreamCommit('a.txt');
    writeFileSync(join(repo, 'README.md'), 'dirty\n');
    const dirty = await pullFastForward(repo, 'main');
    expect(dirty.ok).toBe(false);
    expect(dirty.detail).toContain('uncommitted');
    await sh('git checkout -q -- README.md', repo);
    const ok = await pullFastForward(repo, 'main');
    expect(ok.ok).toBe(true);
    expect(ok.detail).toContain('fast-forwarded main by 1');
    expect(await sh('git rev-parse main', repo)).toBe(await sh('git rev-parse origin/main', repo));
    expect(await sh('test -f a.txt && echo yes', repo)).toBe('yes');
    // not checked out: the ref moves, the working tree stays on the other branch
    await sh('git checkout -q -b feature', repo);
    await upstreamCommit('b.txt');
    const moved = await pullFastForward(repo, 'main');
    expect(moved.ok).toBe(true);
    expect(await sh('git rev-parse main', repo)).toBe(await sh('git rev-parse origin/main', repo));
    expect(await sh('git rev-parse --abbrev-ref HEAD', repo)).toBe('feature');
    // diverged → refused
    await sh('git checkout -q main && printf x > c.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm "feat: c"', repo);
    await upstreamCommit('d.txt');
    const div = await pullFastForward(repo, 'main');
    expect(div.ok).toBe(false);
    expect(div.detail).toContain('diverged');
  });

  test('re-run Clarify while the Brief awaits approval: workspace rebuilt from the fresh remote tip, new Brief proposed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-reclarify-'));
    // the fake clarifier returns no structured output → fallback Brief with a blocking question (awaits approval)
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
    const goal = await engine.createGoal({ prompt: 'clarify me', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval', 20_000);
    const first = getGoal(engine.store.db, goal.id)!;
    expect(first.baseSync).toMatchObject({ startedFrom: 'local', behind: 0 });
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    const firstTip = await sh('git rev-parse HEAD', ws);
    // upstream moves; the user asks for a fresh Brief
    await upstreamCommit('later.txt');
    await engine.reclarify(goal.id, 'upstream moved');
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval' && engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'brief.proposed').length === 2, 20_000);
    const second = getGoal(engine.store.db, goal.id)!;
    expect(second.baseSync).toMatchObject({ startedFrom: 'remote', behind: 1 });
    expect(await sh('git rev-parse HEAD', ws)).not.toBe(firstTip);
    expect(await sh('test -f later.txt && echo yes', ws)).toBe('yes');
    const types = engine.store.listByGoal(goal.id, 5000).map((e) => e.type);
    expect(types.filter((t) => t === 'goal.reclarified').length).toBe(1);
    expect(types.filter((t) => t === 'goal.base_synced').length).toBe(2);
    await expect(engine.reclarify('nope')).rejects.toThrow();
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 40_000);

  test('a goal on a stale checkout starts from origin/main and records goal.base_synced; the worker sees the upstream file', async () => {
    await upstreamCommit('upstream.txt');
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-sync-data-'));
    let sawUpstream = false;
    const engine = new Engine(
      defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), alwaysReviewTasks: false, log: () => {} }),
      new FakeRunner((spec) => {
        sawUpstream = sawUpstream || (spec.label?.startsWith('attempt') === true && require('node:fs').existsSync(join(spec.cwd, 'upstream.txt')));
        writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
      }),
    );
    const goal = await engine.createGoal({ prompt: 'stale checkout', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.state).toBe('done');
    expect(g.baseSync).toMatchObject({ remote: 'origin', base: 'main', behind: 1, ahead: 0, fetched: true, startedFrom: 'remote' });
    expect(sawUpstream).toBe(true);
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    expect(await sh('git merge-base --is-ancestor origin/main HEAD && echo yes', ws)).toBe('yes');
    // the user's checkout is still behind — untouched
    expect(await sh('git rev-list --count main..origin/main', repo)).toBe('1');
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 30_000);
});
