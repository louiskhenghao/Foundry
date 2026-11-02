import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { installPython, pythonEnvPath, pythonOf } from './installer.ts';
import type { InstallContext } from './install-types.ts';

/** the Python environment Foundry makes for a skill whose scripts need packages (ADR-0084), with uv standing in */
let home: string;
let skillDir: string;
const calls: string[][] = [];
const uv = Bun.which('uv');

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-python-env-'));
  skillDir = join(home, 'skills', 'ppt-master');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'requirements.txt'), 'python-pptx>=1.0\n');
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const ctx = (spawn: InstallContext['spawn']): InstallContext => ({ paths: { pythonDir: join(home, 'python') } as InstallContext['paths'], spawn, log: () => {} });
/** a uv that makes the venv's python on `uv venv` and succeeds on `uv pip install` */
const fakeUv: InstallContext['spawn'] = async (argv) => {
  calls.push(argv);
  if (argv[1] === 'venv') {
    mkdirSync(join(argv.at(-1)!, 'bin'), { recursive: true });
    writeFileSync(join(argv.at(-1)!, 'bin', 'python'), '#!/bin/sh\n');
  }
  return { code: 0, tail: '' };
};

describe.skipIf(!uv)('the Python environment of a skill', () => {
  test('is made with uv at the pinned version under <dataDir>/python/<name>, the requirements installed into it, and recorded with their hash', async () => {
    calls.length = 0;
    const r = await installPython('ppt-master', { requirements: 'requirements.txt', version: '3.12' }, skillDir, ctx(fakeUv));
    const venv = pythonEnvPath({ pythonDir: join(home, 'python') }, 'ppt-master');
    expect(r).toEqual({ venv, version: '3.12', requirements: createHash('sha256').update('python-pptx>=1.0\n').digest('hex') });
    expect(calls[0]!.slice(1)).toEqual(['venv', '--python', '3.12', venv]);
    expect(calls[1]!.slice(1)).toEqual(['pip', 'install', '--python', join(venv, 'bin', 'python'), '-r', join(skillDir, 'requirements.txt')]);
    expect(pythonOf({ pythonDir: join(home, 'python') }, 'ppt-master')).toBe(join(venv, 'bin', 'python'));
  });
  test('is not made, and leaves nothing behind, when the requirements file is missing or a uv step fails', async () => {
    expect(await installPython('ppt-master', { requirements: 'nope.txt', version: '3.12' }, skillDir, ctx(fakeUv))).toBeUndefined();
    const failing: InstallContext['spawn'] = async (argv) => (argv[1] === 'venv' ? fakeUv!(argv, '', () => {}) : { code: 1, tail: 'no wheels for skia-pathops' });
    expect(await installPython('ppt-master', { requirements: 'requirements.txt', version: '3.12' }, skillDir, ctx(failing))).toBeUndefined();
    expect(existsSync(pythonEnvPath({ pythonDir: join(home, 'python') }, 'ppt-master'))).toBe(false);
    expect(pythonOf({ pythonDir: join(home, 'python') }, 'ppt-master')).toBeNull();
  });
  test('is not made without a spawner', async () => {
    expect(await installPython('ppt-master', { requirements: 'requirements.txt', version: '3.12' }, skillDir, ctx(undefined))).toBeUndefined();
  });
});
