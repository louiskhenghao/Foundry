import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../../packages/engine/src/test-helpers.ts';

const main = resolve(import.meta.dir, 'main.ts');
const ROOT = resolve(import.meta.dir, '../../..');
let tmp: string;
let repo: string;
afterEach(() => {
  for (const p of [tmp, repo]) rmSync(p, { recursive: true, force: true });
});

/** the CLI against one data folder, with no server up (the port answers nothing) and isolated native homes */
async function cli(dataDir: string, args: string[], stdin?: string) {
  const child = Bun.spawn([process.execPath, main, ...args], {
    cwd: tmp,
    env: { PATH: process.env.PATH, FOUNDRY_URL: 'http://127.0.0.1:9', FOUNDRY_DATA_DIR: dataDir, FOUNDRY_CLAUDE_HOME: join(dataDir, 'claude'), FOUNDRY_CODEX_HOME: join(dataDir, 'codex'), NODE_ENV: 'test' },
    stdin: stdin != null ? new Blob([stdin]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, out, err };
}

test('export and import work offline: a dry run lists what a file would bring, the import brings it', async () => {
  tmp = mkdtempSync(join(tmpdir(), 'foundry-cli-transfer-'));
  repo = await makeRepo();
  const a = join(tmp, 'a');
  const engine = new Engine(defaultConfig(ROOT, { dataDir: a, claudeHome: join(a, 'claude'), codexHome: join(a, 'codex'), log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'an idea for later', repoPath: repo });
  engine.updateSettings({ models: { cheap: 'sonnet' }, tools: { groqApiKey: 'gsk-0123456789abc' } });
  await engine.stop();

  const exported = await cli(a, ['export', '--out', 'move.tgz', '--settings', '--secrets', '--goals', 'all', '--password-stdin'], 'pw\n');
  expect(exported.err).toBe('');
  expect(exported.out).toContain('settings, secrets, goals (1 goal)');
  expect(existsSync(join(tmp, 'move.tgz'))).toBe(true);

  const b = join(tmp, 'b');
  const dry = await cli(b, ['import', 'move.tgz', '--dry-run']);
  expect(dry.out).toContain(`new           ${goal.id}`);
  expect(dry.out).toContain('Keys & secrets: present');
  const done = await cli(b, ['import', 'move.tgz', '--secrets', '--password-stdin', '--no-map', repo], 'pw\n');
  expect(done.out).toContain(`imported   ${goal.id}`);
  expect(done.out).toContain('secrets    tools.groqApiKey');
  const here = new Engine(defaultConfig(ROOT, { dataDir: b, claudeHome: join(b, 'claude'), codexHome: join(b, 'codex'), log: () => {} }), new FakeRunner(() => {}));
  try {
    expect(getGoal(here.store.db, goal.id)?.transfer?.repoMapped).toBeNull();
    expect(here.settings.values().models.cheap).toBe('sonnet');
  } finally {
    await here.stop();
  }
  const refused = await cli(b, ['import', 'move.tgz', '--secrets', '--password-stdin'], 'wrong\n');
  expect(refused.code).not.toBe(0);
  expect(refused.err).toContain('wrong password');
}, 60_000);
