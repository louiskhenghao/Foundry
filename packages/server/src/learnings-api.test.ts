import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test("a folder's Learnings are listed, edited by the person, and counted on its goals' pages", async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-learnings-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  const put = (body: unknown) => app.request('/api/learnings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    expect(await (await app.request('/api/learnings')).json()).toEqual({ repos: [] });
    const saved = await put({ repoPath: repo, learnings: [{ kind: 'build', text: 'Run bun install first.' }, { kind: 'test', text: '  ' }] });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.learnings).toEqual([expect.objectContaining({ kind: 'build', text: 'Run bun install first.', by: 'human', goalId: null })]);
    expect((await (await app.request(`/api/learnings?repo=${encodeURIComponent(repo)}`)).json()).learnings).toHaveLength(1);
    expect((await (await app.request('/api/learnings')).json()).repos.map((r: { repoPath: string }) => r.repoPath)).toEqual([repo]);

    const goal = await engine.createGoal({ prompt: 'a goal in that folder', repoPath: repo, nature: 'code' });
    expect((await (await app.request(`/api/goals/${goal.id}`)).json()).learningsCount).toBe(1);

    expect((await put({ repoPath: 'relative/path', learnings: [] })).status).toBe(400);
    expect((await put({ repoPath: repo, learnings: [{ kind: 'build', text: 'x'.repeat(301) }] })).status).toBe(422);
    expect((await put({ repoPath: repo, learnings: [{ kind: 'nonsense', text: 'a' }] })).status).toBe(400);
  } finally {
    await engine.stop();
    for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
  }
}, 30_000);
