import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, type DeliveryPolicy } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { FakeGh } from '../delivery/gh.fake.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, makeRepoWithRemote, sh, terminal, waitFor } from '../test-helpers.ts';
import { sortDeployChanges } from './keep-files.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let bin: string;
const engines: Engine[] = [];
const cleanup: string[] = [];

/**
 * Stand-ins for the hosts' CLIs that change the project as the real ones do: Vercel links its folder and adds it to
 * .gitignore (once); Netlify leaves its folder (the link, a build) where git sees it; and an install's leftovers.
 */
function fakeCli(dir: string): string {
  const path = join(dir, 'fake-host');
  writeFileSync(
    path,
    `#!/bin/sh
host="$1"; shift
case "$host" in
  vercel) mkdir -p .vercel && echo '{"projectId":"p"}' > .vercel/project.json; grep -qx .vercel .gitignore 2>/dev/null || printf '.vercel\\n' >> .gitignore; echo "https://site-abc.vercel.app" ;;
  netlify) mkdir -p .netlify/v1 node_modules/x && echo '{"siteId":"s"}' > .netlify/state.json && echo built > .netlify/v1/index.html && echo x > node_modules/x/i.js && echo '{}' > package-lock.json; echo '{"deploy_url":"https://d1--site.netlify.app","url":"https://site.netlify.app"}' ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-keep-'));
  bin = fakeCli(mkdtempSync(join(tmpdir(), 'foundry-keep-cli-')));
  cleanup.push(dataDir, join(bin, '..'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of cleanup.splice(0)) rmSync(p, { recursive: true, force: true });
});

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000 } });
const notes = (engine: Engine, id: string) => engine.store.listByGoal(id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message).filter((m) => m.startsWith('deploy: ') && / changed /.test(m));
const last = (engine: Engine, id: string) => (getGoal(engine.store.db, id)!.deployments ?? []).at(-1);

/** a goal on a page, delivered as `mode` says (through the fake GitHub when there is a remote), its hosts the stand-ins */
async function deliveredGoal(repo: string, mode: DeliveryPolicy['mode'], gh?: FakeGh) {
  writeFileSync(join(repo, 'index.html'), '<h1>studio</h1>');
  // a .gitignore of its own, as projects have: a host's line makes it a changed file, not a new one
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  await sh(`git add -A && git -c user.name=t -c user.email=t@t commit -q -m page${gh ? ' && git push -q origin main' : ''}`, repo);
  const engine = new Engine(cfg(), new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok')), gh);
  engines.push(engine);
  engine.updateSettings({ delivery: { vercelToken: 'vcp_SECRET_TOKEN', netlifyToken: 'nfp_SECRET_TOKEN' } });
  engine.deployCli = (p) => [bin, p];
  const goal = await engine.createGoal({ prompt: 'a page', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
  if (mode !== 'local') await waitFor(() => ['delivered', 'failed'].includes(getGoal(engine.store.db, goal.id)!.delivery.status), 20_000);
  return { engine, goal: getGoal(engine.store.db, goal.id)! };
}

describe('what a deploy added to the project', () => {
  test('sorted: the hosts’ folders are ignored rather than kept; installs, builds and the package files stay out; the rest is kept', () => {
    expect(sortDeployChanges(['.gitignore', '.netlify/', 'apps/web/.vercel/', 'dist/', 'node_modules/', 'package-lock.json', 'apps/web/package.json', '.next/', 'netlify.toml', 'apps/web/out/'], ['dist', 'apps/web/out'])).toEqual({ keep: ['.gitignore', 'netlify.toml'], ignore: ['.netlify', '.vercel'] });
    expect(sortDeployChanges(['index.html'], ['.'])).toEqual({ keep: ['index.html'], ignore: [] });
    expect(sortDeployChanges([], ['dist'])).toEqual({ keep: [], ignore: [] });
  });

  test('while the goal’s pull request is open, it is committed onto the goal’s branch and pushed into that pull request; a deploy that adds nothing commits nothing', async () => {
    const { repo, bare } = await makeRepoWithRemote();
    cleanup.push(repo, `${repo}-foundry`, bare);
    const { engine, goal } = await deliveredGoal(repo, 'pr', new FakeGh(bare));
    expect(goal.delivery).toMatchObject({ outcome: 'pr_open', prs: [{ number: 1, state: 'open', branch: goal.branch }] });
    const before = await sh(`git rev-parse ${goal.branch}`, bare);

    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'live' && notes(engine, goal.id).length === 1);
    expect(notes(engine, goal.id)[0]).toMatch(new RegExp(`^deploy: Vercel changed \\.gitignore: committed [0-9a-f]{7} onto ${goal.branch} and pushed it to origin, into pull request #1$`));
    const after = await sh(`git rev-parse ${goal.branch}`, bare);
    expect(await sh(`git rev-parse ${after}~1`, bare)).toBe(before);
    expect((await sh(`git show ${goal.branch}:.gitignore`, bare)).split('\n')).toContain('.vercel');
    expect(await sh(`git ls-tree -r --name-only ${goal.branch}`, bare)).not.toContain('.vercel/');
    expect(await sh(`git log -1 --format=%s ${goal.branch}`, bare)).toBe('chore(deploy): keep what the Vercel deploy added');
    // the local goal branch is where the remote one is
    expect(await sh(`git rev-parse ${goal.branch}`, repo)).toBe(after);

    // again: .vercel is ignored now, so the deploy adds nothing
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status === 'live');
    expect(await sh(`git rev-parse ${goal.branch}`, bare)).toBe(after);
    expect(notes(engine, goal.id)).toHaveLength(1);
  }, 60_000);

  test('once the goal merged, a pull request of its own from the online base, merged as the goal’s policy merges; the host’s folder, the build, the install never go', async () => {
    const { repo, bare } = await makeRepoWithRemote();
    cleanup.push(repo, `${repo}-foundry`, bare);
    const { engine, goal } = await deliveredGoal(repo, 'pr-automerge', new FakeGh(bare));
    expect(goal.delivery.outcome).toBe('merged');
    await waitFor(() => getGoal(engine.store.db, goal.id)!.delivery.cleanup != null);

    engine.deploy(goal.id, { provider: 'netlify', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'live' && notes(engine, goal.id).length === 1);
    expect(notes(engine, goal.id)[0]).toStartWith('deploy: Netlify changed .gitignore (.netlify kept out of git): pull request #2 merged with squash');
    expect((await sh('git show main:.gitignore', bare)).split('\n')).toContain('.netlify');
    const tree = await sh('git ls-tree -r --name-only main', bare);
    for (const out of ['.netlify/', 'node_modules/', 'package-lock.json']) expect(tree).not.toContain(out);
    expect(tree).toContain('done.txt');
  }, 60_000);

  test('a Local only goal keeps nothing: no commit, no note', async () => {
    const repo = await makeRepo();
    cleanup.push(repo, `${repo}-foundry`);
    const { engine, goal } = await deliveredGoal(repo, 'local');
    const before = await sh(`git rev-parse ${goal.branch}`, repo);
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'live');
    expect(await sh(`git rev-parse ${goal.branch}`, repo)).toBe(before);
    expect(notes(engine, goal.id)).toEqual([]);
  }, 60_000);
});
