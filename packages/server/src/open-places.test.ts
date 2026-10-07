import { expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

test('an Open menu place is resolved on the server: a resolve worktree only for a task of the goal, never a path from the request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-open-places-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  try {
    const goal = await engine.createGoal({ prompt: 'open places', repoPath: repo, nature: 'code' });
    const open = (which: string) => app.request(`/api/goals/${goal.id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'finder', which }) });
    for (const which of [`resolve:${'../'.repeat(30)}etc`, 'resolve:t_nope', 'task:t_nope']) {
      const r = await open(which);
      expect(r.status).toBe(404);
      expect((await r.json()).error).toContain('nothing to open');
    }
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
