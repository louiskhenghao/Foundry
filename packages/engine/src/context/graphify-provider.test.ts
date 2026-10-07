import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, sh } from '../test-helpers.ts';
import { GraphifyContextProvider, hasCode } from './graphify-provider.ts';
import { GrepContextProvider } from './grep-provider.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a stand-in graphify that, like the real one, creates graphify-out/ for its lock and writes no graph */
function fakeGraphify(): GraphifyContextProvider {
  const bin = join(mkdtempSync(join(tmpdir(), 'foundry-graphify-bin-')), 'graphify');
  dirs.push(join(bin, '..'));
  writeFileSync(bin, '#!/bin/sh\nmkdir -p "$2/graphify-out"\ntouch "$2/.graphify-ran"\n');
  chmodSync(bin, 0o755);
  const p = new GraphifyContextProvider(new GrepContextProvider());
  (p as unknown as { bin: string }).bin = bin;
  return p;
}

describe('graphify context', () => {
  test('a repository without source files is not graphed, so no empty graphify-out/ is left', async () => {
    const repo = await makeRepo();
    dirs.push(repo);
    expect(await hasCode(repo)).toBe(false);
    await fakeGraphify().prepare(repo);
    expect(existsSync(join(repo, '.graphify-ran'))).toBe(false);
    expect(existsSync(join(repo, 'graphify-out'))).toBe(false);
  });

  test('a repository with code is graphed; an empty graphify-out/ left behind is removed', async () => {
    const repo = await makeRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'main.ts'), 'export {};\n');
    await sh('git add main.ts && git commit -qm "feat: main"', repo);
    expect(await hasCode(repo)).toBe(true);
    await fakeGraphify().prepare(repo);
    expect(existsSync(join(repo, '.graphify-ran'))).toBe(true);
    expect(existsSync(join(repo, 'graphify-out'))).toBe(false);
  });
});
