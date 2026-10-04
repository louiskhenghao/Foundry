import { expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

for (const launch of ['claude', 'codex'] as const) test(`health reports independent pauses in a ${launch}-default instance`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-health-provider-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { provider: launch, dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const health = async () => (await app.request('/api/health')).json();
  try {
    expect((await health()).pausedUntilByProvider).toEqual({ claude: null, codex: null });
    const other = launch === 'codex' ? 'claude' : 'codex';
    const first = Date.now() + 60_000;
    engine.pauseUntil(first, null, 'fixture', other);
    const one = await health();
    expect(one.pausedUntil).toBeNull();
    expect(one.pausedUntilByProvider).toEqual({ [launch]: null, [other]: new Date(first).toISOString() });
    const second = first + 60_000;
    engine.pauseUntil(second, null, 'fixture', launch);
    const both = await health();
    expect(both.pausedUntil).toBe(new Date(second).toISOString());
    expect(both.pausedUntilByProvider).toEqual({ [launch]: new Date(second).toISOString(), [other]: new Date(first).toISOString() });
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
